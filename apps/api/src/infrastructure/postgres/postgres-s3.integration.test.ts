import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExportJob,
  LayerDocument,
  ProcessingJob,
  SubscriptionView,
} from "@motionprep/contracts";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimNextProcessingJob } from "../../processing/processing-worker-runtime.js";
import { S3ObjectStorage } from "../../storage/s3-object-storage.js";
import {
  PostgresRetentionStore,
  RetentionCleanup,
} from "../../maintenance/retention-cleanup.js";
import { PostgresRetentionRunner } from "../../maintenance/retention-runtime.js";
import { runExportWorker } from "../../exports/export-worker-runtime.js";
import { PostgresExportRepository } from "./postgres-export-repository.js";
import { PostgresBillingRepository } from "./postgres-billing-repository.js";
import {
  PostgresLayerDocumentRepository,
  PostgresProcessingJobRepository,
} from "./postgres-processing-repository.js";
import { PostgresProjectRepository } from "./postgres-project-repository.js";
import { PostgresSourceVersionRestoreCommand } from "./postgres-source-version-restore.js";
import { PostgresUploadFinalizationCommand } from "./postgres-upload-finalization.js";
import { PostgresUploadRepository } from "./postgres-upload-repository.js";
import { PostgresAuthRepository } from "./postgres-auth-repository.js";
import { PostgresEmailOutboxRepository } from "./postgres-email-outbox.js";

const integrationEnvironment = {
  databaseUrl: requireEnvironment("INTEGRATION_DATABASE_URL"),
  endpoint: requireEnvironment("INTEGRATION_S3_ENDPOINT"),
  bucket: requireEnvironment("INTEGRATION_S3_BUCKET"),
  accessKeyId: requireEnvironment("INTEGRATION_S3_ACCESS_KEY"),
  secretAccessKey: requireEnvironment("INTEGRATION_S3_SECRET_KEY"),
};
const migrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../migrations",
);

describe("PostgreSQL and S3-compatible infrastructure", () => {
  let pool: Pool;
  let storage: S3ObjectStorage;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: integrationEnvironment.databaseUrl,
      max: 4,
    });
    storage = new S3ObjectStorage({
      endpoint: integrationEnvironment.endpoint,
      region: "us-east-1",
      bucket: integrationEnvironment.bucket,
      accessKeyId: integrationEnvironment.accessKeyId,
      secretAccessKey: integrationEnvironment.secretAccessKey,
      forcePathStyle: true,
      encryptionMode: "none",
      requireVersioning: false,
    });
    await Promise.all([pool.query("SELECT 1"), storage.ready(true)]);
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE users CASCADE");
  });

  afterAll(async () => {
    storage.destroy();
    await pool.end();
  });

  it("records every migration and exposes the worker lease columns", async () => {
    const expectedMigrations = (await readdir(migrationsDirectory))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();
    const applied = await pool.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations ORDER BY filename",
    );
    const columns = await pool.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN ('processing_jobs', 'export_jobs')
         AND column_name IN ('attempt', 'max_attempts', 'lease_owner', 'lease_expires_at')
       ORDER BY table_name, column_name`,
    );

    expect(applied.rows.map((row) => row.filename)).toEqual(
      expectedMigrations,
    );
    expect(columns.rows).toHaveLength(8);
  });

  it("atomically creates a password reset and durable email delivery", async () => {
    const fixture = await insertProjectFixture(pool, "image");
    const user = await pool.query<{ owner_user_id: string }>(
      "SELECT owner_user_id FROM projects WHERE id = $1",
      [fixture.projectId],
    );
    const userId = user.rows[0]!.owner_user_id;
    const issuedAt = new Date();
    const claimAt = new Date(issuedAt.getTime() + 1_000);
    const record = {
      tokenHash: "a".repeat(64),
      userId,
      expiresAt: new Date(issuedAt.getTime() + 30 * 60_000).toISOString(),
    };
    const delivery = {
      recipient: "owner@example.com",
      resetUrl: "https://studio.example.com/reset?token=secret",
      expiresAt: record.expiresAt,
    };
    const failing = new PostgresAuthRepository(pool, {
      async afterPasswordResetStored() {
        throw new Error("injected outbox failure");
      },
    });

    await expect(
      failing.savePasswordReset(record, delivery),
    ).rejects.toThrow("injected outbox failure");
    expect(
      await pool.query(
        "SELECT token_hash FROM password_reset_tokens WHERE token_hash = $1",
        [record.tokenHash],
      ),
    ).toMatchObject({ rowCount: 0 });

    const repository = new PostgresAuthRepository(pool);
    await expect(repository.savePasswordReset(record, delivery)).resolves.toBe(
      "queued",
    );
    const outbox = new PostgresEmailOutboxRepository(pool);
    const claimed = await outbox.claimNext(
      "integration-email",
      claimAt.toISOString(),
      new Date(claimAt.getTime() + 60_000).toISOString(),
    );
    expect(claimed).toMatchObject({
      attempt: 1,
      message: delivery,
    });
    await expect(
      outbox.markSent(
        claimed!.id,
        "integration-email",
        new Date(claimAt.getTime() + 1_000).toISOString(),
      ),
    ).resolves.toBe(true);
    const scrubbed = await pool.query<{
      status: string;
      recipient: string;
      reset_url: string;
    }>(
      "SELECT status, recipient, reset_url FROM email_outbox WHERE id = $1",
      [claimed!.id],
    );
    expect(scrubbed.rows[0]).toEqual({
      status: "sent",
      recipient: "",
      reset_url: "",
    });
  });

  it("keeps release N and N+1 upload URL writes compatible", async () => {
    const fixture = await insertProjectFixture(pool, "image");
    const legacyUploadId = crypto.randomUUID();
    const currentUploadId = crypto.randomUUID();
    const insertBase = `
      INSERT INTO upload_sessions (
        upload_id, project_id, filename, content_type, expected_size_bytes,
        status, object_key, expires_at, max_bytes,
        %COLUMN%, created_at, updated_at
      )
      VALUES (
        $1, $2, 'compatibility.png', 'image/png', 1,
        'cancelled', $3, now() + interval '1 hour', 31457280,
        $4, now(), now()
      )
    `;
    await pool.query(insertBase.replace("%COLUMN%", "demo_upload_url"), [
      legacyUploadId,
      fixture.projectId,
      `sources/${fixture.projectId}/${legacyUploadId}.png`,
      `/legacy/${legacyUploadId}`,
    ]);
    await pool.query(insertBase.replace("%COLUMN%", "upload_url"), [
      currentUploadId,
      fixture.projectId,
      `sources/${fixture.projectId}/${currentUploadId}.png`,
      `/current/${currentUploadId}`,
    ]);

    const rows = await pool.query<{
      upload_id: string;
      demo_upload_url: string;
      upload_url: string;
    }>(
      `SELECT upload_id, demo_upload_url, upload_url
       FROM upload_sessions
       WHERE upload_id = ANY($1::uuid[])
       ORDER BY upload_id`,
      [[legacyUploadId, currentUploadId]],
    );

    expect(rows.rows).toHaveLength(2);
    for (const row of rows.rows) {
      expect(row.demo_upload_url).toBe(row.upload_url);
    }
  });

  it("publishes verified upload metadata atomically and preserves progressed state on replay", async () => {
    const fixture = await insertProjectFixture(pool, "image");
    const uploadId = crypto.randomUUID();
    const sourceVersionId = crypto.randomUUID();
    const timestamp = "2026-08-01T12:00:00.000Z";
    const sha256 = "a".repeat(64);
    await pool.query(
      "UPDATE projects SET status = 'uploading' WHERE id = $1",
      [fixture.projectId],
    );
    await pool.query(
      `
        INSERT INTO source_versions (
          id, project_id, upload_id, version_number, filename, content_type,
          size_bytes, status, sha256, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 1, 'atomic.png', 'image/png', 1,
          'uploading', NULL, $4, $4
        )
      `,
      [sourceVersionId, fixture.projectId, uploadId, timestamp],
    );
    await pool.query(
      `
        INSERT INTO upload_sessions (
          upload_id, project_id, filename, content_type, expected_size_bytes,
          status, source_version_id, sha256, object_key, expires_at, max_bytes,
          upload_url, demo_upload_url, created_at, updated_at
        ) VALUES (
          $1, $2, 'atomic.png', 'image/png', 1, 'uploading', $3, NULL,
          $4, $5, 31457280, $6, $6, $7, $7
        )
      `,
      [
        uploadId,
        fixture.projectId,
        sourceVersionId,
        `sources/${fixture.projectId}/${uploadId}.png`,
        "2026-08-01T12:10:00.000Z",
        `/v1/uploads/${uploadId}/content`,
        timestamp,
      ],
    );
    const uploads = new PostgresUploadRepository(pool);
    const session = await uploads.findById(uploadId);
    if (!session) throw new Error("Atomic upload fixture was not inserted.");

    const failing = new PostgresUploadFinalizationCommand(pool, {
      afterUploadUpdated: async () => {
        throw new Error("injected finalization failure");
      },
    });
    await expect(failing.finalize({ session, sha256 })).rejects.toThrow(
      "injected finalization failure",
    );
    const rolledBack = await pool.query<{
      upload_status: string;
      source_status: string;
      project_status: string;
      current_source_version_id: string | null;
    }>(
      `
        SELECT upload.status AS upload_status,
          source.status AS source_status,
          project.status AS project_status,
          project.current_source_version_id
        FROM upload_sessions AS upload
        JOIN source_versions AS source ON source.id = upload.source_version_id
        JOIN projects AS project ON project.id = upload.project_id
        WHERE upload.upload_id = $1
      `,
      [uploadId],
    );
    expect(rolledBack.rows[0]).toEqual({
      upload_status: "uploading",
      source_status: "uploading",
      project_status: "uploading",
      current_source_version_id: null,
    });

    const command = new PostgresUploadFinalizationCommand(pool);
    const ready = await command.finalize({ session, sha256 });
    expect(ready).toMatchObject({ status: "ready", sha256 });
    await pool.query(
      "UPDATE projects SET status = 'needs_review' WHERE id = $1",
      [fixture.projectId],
    );
    await command.finalize({ session: ready, sha256 });
    const published = await pool.query<{
      upload_status: string;
      source_status: string;
      project_status: string;
      current_source_version_id: string | null;
    }>(
      `
        SELECT upload.status AS upload_status,
          source.status AS source_status,
          project.status AS project_status,
          project.current_source_version_id
        FROM upload_sessions AS upload
        JOIN source_versions AS source ON source.id = upload.source_version_id
        JOIN projects AS project ON project.id = upload.project_id
        WHERE upload.upload_id = $1
      `,
      [uploadId],
    );
    expect(published.rows[0]).toEqual({
      upload_status: "ready",
      source_status: "ready",
      project_status: "needs_review",
      current_source_version_id: sourceVersionId,
    });

    const newerUploadId = crypto.randomUUID();
    const newerSourceVersionId = crypto.randomUUID();
    await pool.query(
      `
        INSERT INTO source_versions (
          id, project_id, upload_id, version_number, filename, content_type,
          size_bytes, status, sha256, created_at, updated_at
        ) VALUES (
          $1, $2, $3, 2, 'newer.png', 'image/png', 1,
          'ready', $4, $5, $5
        )
      `,
      [
        newerSourceVersionId,
        fixture.projectId,
        newerUploadId,
        "b".repeat(64),
        timestamp,
      ],
    );
    await pool.query(
      `
        INSERT INTO upload_sessions (
          upload_id, project_id, filename, content_type, expected_size_bytes,
          status, source_version_id, sha256, object_key, expires_at, max_bytes,
          upload_url, demo_upload_url, created_at, updated_at
        ) VALUES (
          $1, $2, 'newer.png', 'image/png', 1, 'ready', $3, $4,
          $5, $6, 31457280, $7, $7, $8, $8
        )
      `,
      [
        newerUploadId,
        fixture.projectId,
        newerSourceVersionId,
        "b".repeat(64),
        `sources/${fixture.projectId}/${newerUploadId}.png`,
        "2026-08-01T12:10:00.000Z",
        `/v1/uploads/${newerUploadId}/content`,
        timestamp,
      ],
    );
    await pool.query(
      `UPDATE projects
       SET current_source_version_id = $2, status = 'needs_review'
       WHERE id = $1`,
      [fixture.projectId, newerSourceVersionId],
    );

    await command.finalize({ session: ready, sha256 });
    await expect(command.findCandidates(100)).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ uploadId }),
      ]),
    );
    const afterHistoricalReplay = await pool.query<{
      current_source_version_id: string | null;
      status: string;
    }>(
      "SELECT current_source_version_id, status FROM projects WHERE id = $1",
      [fixture.projectId],
    );
    expect(afterHistoricalReplay.rows[0]).toEqual({
      current_source_version_id: newerSourceVersionId,
      status: "needs_review",
    });
  });

  it("restores one source version atomically and deduplicates concurrent replay", async () => {
    const actorUserId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const firstId = crypto.randomUUID();
    const secondId = crypto.randomUUID();
    const timestamp = "2026-07-28T09:00:00.000Z";
    await pool.query(
      `INSERT INTO users (
         id, name, email, role, status, password_hash, created_at
       ) VALUES ($1, 'Restore User', $2, 'creator', 'active', 'hash', $3)`,
      [actorUserId, `${actorUserId}@example.test`, timestamp],
    );
    await pool.query(
      `INSERT INTO projects (
         id, owner_user_id, name, kind, status, created_at, updated_at
       ) VALUES ($1, $2, 'Restore Project', 'image', 'needs_review', $3, $3)`,
      [projectId, actorUserId, timestamp],
    );
    for (const [id, versionNumber] of [
      [firstId, 1],
      [secondId, 2],
    ] as const) {
      await pool.query(
        `INSERT INTO source_versions (
           id, project_id, upload_id, version_number, filename, content_type,
           size_bytes, status, sha256, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, 'image/png', 1, 'ready', $6, $7, $7
         )`,
        [
          id,
          projectId,
          crypto.randomUUID(),
          versionNumber,
          `v${versionNumber}.png`,
          String(versionNumber).repeat(64),
          timestamp,
        ],
      );
    }
    await pool.query(
      "UPDATE projects SET current_source_version_id = $2 WHERE id = $1",
      [projectId, secondId],
    );
    const command = new PostgresSourceVersionRestoreCommand(pool);
    const input = {
      projectId,
      actorUserId,
      targetSourceVersionId: firstId,
      expectedCurrentSourceVersionId: secondId,
      reason: "Restore the reviewed source version.",
      requestId: "integration-restore-001",
    };

    const results = await Promise.all([
      command.restore(input),
      command.restore(input),
    ]);
    const events = await command.list(projectId, actorUserId);
    const project = await pool.query<{
      current_source_version_id: string;
      status: string;
    }>(
      "SELECT current_source_version_id, status FROM projects WHERE id = $1",
      [projectId],
    );

    expect(results.map((result) => result.replayed).sort()).toEqual([
      false,
      true,
    ]);
    expect(events).toHaveLength(1);
    expect(project.rows[0]).toEqual({
      current_source_version_id: firstId,
      status: "needs_review",
    });
  });

  it("atomically reclaims one expired export lease", async () => {
    const fixture = await insertProjectFixture(pool, "image");
    const repository = new PostgresExportRepository(pool);
    const expiredJob = createExportJob(fixture, {
      status: "generating",
      attempt: 1,
      leaseOwner: "worker-a",
      leaseExpiresAt: "2026-07-28T09:59:00.000Z",
    });
    await repository.save(expiredJob);

    const claims = await Promise.all([
      repository.claimNext(
        "worker-b",
        "2026-07-28T10:00:00.000Z",
        "2026-07-28T10:05:00.000Z",
      ),
      repository.claimNext(
        "worker-c",
        "2026-07-28T10:00:00.000Z",
        "2026-07-28T10:05:00.000Z",
      ),
    ]);
    const successfulClaims = claims.filter(
      (claim): claim is ExportJob => claim !== null,
    );

    expect(successfulClaims).toHaveLength(1);
    expect(successfulClaims[0]).toMatchObject({
      id: expiredJob.id,
      status: "generating",
      attempt: 2,
      leaseExpiresAt: "2026-07-28T10:05:00.000Z",
    });
    expect(["worker-b", "worker-c"]).toContain(
      successfulClaims[0]?.leaseOwner,
    );
  });

  it("reclaims an expired processing lease and fails an exhausted one", async () => {
    const fixture = await insertProjectFixture(pool, "book");
    const repository = new PostgresProcessingJobRepository(pool);
    const expiredJob = createProcessingJob(fixture, {
      status: "processing",
      attempt: 1,
      maxAttempts: 3,
      leaseOwner: "document-a",
      leaseExpiresAt: "2020-01-01T00:00:00.000Z",
    });
    await repository.save(expiredJob);

    const claims = await Promise.all([
      claimNextProcessingJob(pool, "book", "document-b", 60_000),
      claimNextProcessingJob(pool, "book", "document-c", 60_000),
    ]);
    const successfulClaims = claims.filter(
      (claim): claim is ProcessingJob => claim !== null,
    );
    expect(successfulClaims).toHaveLength(1);
    expect(successfulClaims[0]).toMatchObject({
      id: expiredJob.id,
      status: "processing",
      attempt: 2,
    });

    const exhaustedJob = createProcessingJob(
      {
        ...fixture,
        sourceVersionId: crypto.randomUUID(),
      },
      {
        status: "verifying",
        attempt: 3,
        maxAttempts: 3,
        leaseOwner: "document-old",
        leaseExpiresAt: "2020-01-01T00:00:00.000Z",
      },
    );
    await repository.save(exhaustedJob);
    expect(
      await claimNextProcessingJob(pool, "book", "document-d", 60_000),
    ).toBeNull();
    expect(await repository.findById(exhaustedJob.id)).toMatchObject({
      status: "failed",
      errorCode: "WORKER_LEASE_EXHAUSTED",
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  });

  it("round-trips and deletes bytes through real S3-compatible storage", async () => {
    const key = `integration/${crypto.randomUUID()}/probe.bin`;
    const body = Buffer.from("motionprep durable storage probe");

    try {
      await storage.put({
        key,
        body,
        contentType: "application/octet-stream",
        sizeBytes: body.byteLength,
      });
      expect(await storage.get(key)).toEqual({
        key,
        body,
        contentType: "application/octet-stream",
        sizeBytes: body.byteLength,
      });
      const streamed = await storage.getStream(key);
      const chunks: Buffer[] = [];
      for await (const chunk of streamed!.body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks)).toEqual(body);
    } finally {
      await storage.delete(key);
    }
    expect(await storage.get(key)).toBeNull();
  });

  it("rejects stale provider subscription events atomically", async () => {
    const fixture = await insertProjectFixture(pool, "image");
    const user = await pool.query<{ owner_user_id: string }>(
      "SELECT owner_user_id FROM projects WHERE id = $1",
      [fixture.projectId],
    );
    const userId = user.rows[0]!.owner_user_id;
    const repository = new PostgresBillingRepository(pool);
    const current = createSubscription(userId, {
      planId: "studio",
      status: "active",
    });
    const stale = createSubscription(userId, {
      planId: "starter",
      status: "cancelled",
    });

    await expect(
      repository.saveSubscriptionFromProvider(current, {
        eventId: "evt_200",
        occurredAt: 200,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.saveSubscriptionFromProvider(stale, {
        eventId: "evt_100",
        occurredAt: 100,
      }),
    ).resolves.toBe(false);
    await expect(
      repository.saveSubscriptionFromProvider(stale, {
        eventId: "evt_200",
        occurredAt: 200,
      }),
    ).resolves.toBe(false);

    await expect(repository.findSubscription(userId)).resolves.toMatchObject({
      planId: "studio",
      status: "active",
    });
  });

  it("prunes only unreferenced terminal source versions", async () => {
    const fixture = await insertProjectFixture(pool, "image");
    const removableSourceId = crypto.randomUUID();
    const retainedSourceId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO source_versions (
         id, project_id, upload_id, version_number, filename, content_type,
         size_bytes, status, sha256, created_at, updated_at
       ) VALUES
         ($1, $3, $4, 1, 'removable.png', 'image/png', 1, 'failed', NULL, $6, $6),
         ($2, $3, $5, 2, 'retained.png', 'image/png', 1, 'failed', NULL, $6, $6)`,
      [
        removableSourceId,
        retainedSourceId,
        fixture.projectId,
        crypto.randomUUID(),
        crypto.randomUUID(),
        "2020-01-01T00:00:00.000Z",
      ],
    );
    await pool.query(
      "UPDATE projects SET current_source_version_id = $2 WHERE id = $1",
      [fixture.projectId, retainedSourceId],
    );

    const counts = await new PostgresRetentionStore(pool).pruneDatabase(
      "2026-07-28T10:00:00.000Z",
      retentionConfig(),
    );
    const remaining = await pool.query<{ id: string }>(
      "SELECT id FROM source_versions WHERE id = ANY($1::uuid[]) ORDER BY id",
      [[removableSourceId, retainedSourceId]],
    );

    expect(counts.sourceVersions).toBe(1);
    expect(remaining.rows.map((row) => row.id)).toEqual([retainedSourceId]);
  });

  it("reserves a project for only one active job", async () => {
    const fixture = await insertProjectFixture(pool, "image");
    await pool.query(
      `INSERT INTO source_versions (
         id, project_id, upload_id, version_number, filename, content_type,
         size_bytes, status, sha256, created_at, updated_at
       ) VALUES ($1, $2, $3, 1, 'ready.png', 'image/png', 1, 'ready', $4, $5, $5)`,
      [
        fixture.sourceVersionId,
        fixture.projectId,
        crypto.randomUUID(),
        "a".repeat(64),
        "2026-07-28T09:00:00.000Z",
      ],
    );
    await pool.query(
      "UPDATE projects SET current_source_version_id = $2 WHERE id = $1",
      [fixture.projectId, fixture.sourceVersionId],
    );
    const projects = new PostgresProjectRepository(pool);
    const firstJobId = crypto.randomUUID();

    await expect(
      projects.updateStatusForSource(
        fixture.projectId,
        fixture.sourceVersionId,
        "processing",
        { type: "processing", id: firstJobId },
      ),
    ).resolves.toMatchObject({ status: "processing" });
    await expect(
      projects.updateStatusForSource(
        fixture.projectId,
        fixture.sourceVersionId,
        "exporting",
        { type: "export", id: crypto.randomUUID() },
      ),
    ).resolves.toBeNull();
    await expect(
      projects.finishJobStatus(
        fixture.projectId,
        fixture.sourceVersionId,
        { type: "processing", id: firstJobId },
        "needs_review",
      ),
    ).resolves.toMatchObject({ status: "needs_review" });
  });

  it("records successful retention maintenance while holding the database lock", async () => {
    const config = retentionConfig();
    const runner = new PostgresRetentionRunner(
      pool,
      new RetentionCleanup(
        new PostgresRetentionStore(pool),
        storage,
        config,
        () => new Date("2026-07-28T10:00:00.000Z"),
      ),
      config.RETENTION_RUN_INTERVAL_MINUTES * 60_000,
    );

    await expect(runner.run()).resolves.toMatchObject({
      checkedAt: "2026-07-28T10:00:00.000Z",
    });
    const status = await pool.query<{
      task: string;
      last_succeeded_at: Date | null;
      last_error: string | null;
    }>(
      `SELECT task, last_succeeded_at, last_error
       FROM maintenance_status WHERE task = 'retention'`,
    );

    expect(status.rows[0]).toMatchObject({
      task: "retention",
      last_succeeded_at: expect.any(Date),
      last_error: null,
    });
  });

  it("purges expired upload and export objects through the retention task", async () => {
    const fixture = await insertProjectFixture(pool, "image");
    const uploadId = crypto.randomUUID();
    const uploadKey = `sources/${fixture.projectId}/${uploadId}.png`;
    const exportJob = createExportJob(fixture, {
      status: "ready",
      progress: 100,
      artifact: {
        filename: "retention.psd",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        expiresAt: "2026-07-28T09:30:00.000Z",
      },
    });
    const exportKey = `artifacts/${fixture.projectId}/${exportJob.id}/retention.psd`;
    await Promise.all([
      storage.put({
        key: uploadKey,
        contentType: "image/png",
        sizeBytes: 1,
        body: Buffer.from([1]),
      }),
      storage.put({
        key: exportKey,
        contentType: "application/octet-stream",
        sizeBytes: 1,
        body: Buffer.from([2]),
      }),
    ]);
    await pool.query(
      `
        INSERT INTO upload_sessions (
          upload_id, project_id, filename, content_type, expected_size_bytes,
          status, source_version_id, sha256, object_key, expires_at, max_bytes,
          upload_url, created_at, updated_at
        )
        VALUES (
          $1, $2, 'expired.png', 'image/png', 1, 'cancelled', NULL, NULL,
          $3, '2026-07-28T09:30:00.000Z', 31457280, $4,
          '2026-07-28T09:00:00.000Z', '2026-07-28T09:00:00.000Z'
        )
      `,
      [uploadId, fixture.projectId, uploadKey, `/v1/uploads/${uploadId}/content`],
    );
    await new PostgresExportRepository(pool).save(exportJob);

    const report = await new RetentionCleanup(
      new PostgresRetentionStore(pool),
      storage,
      retentionConfig(),
      () => new Date("2026-07-28T10:00:00.000Z"),
    ).run();

    expect(report).toMatchObject({
      uploadsPurged: 1,
      artifactsPurged: 1,
      failures: [],
    });
    await expect(storage.get(uploadKey)).resolves.toBeNull();
    await expect(storage.get(exportKey)).resolves.toBeNull();
    const purged = await pool.query<{
      upload_purged_at: Date | null;
      artifact_purged_at: Date | null;
    }>(
      `
        SELECT
          upload.object_purged_at AS upload_purged_at,
          job.artifact_purged_at AS artifact_purged_at
        FROM upload_sessions AS upload
        CROSS JOIN export_jobs AS job
        WHERE upload.upload_id = $1 AND job.id = $2
      `,
      [uploadId, exportJob.id],
    );
    expect(purged.rows[0]?.upload_purged_at).toBeInstanceOf(Date);
    expect(purged.rows[0]?.artifact_purged_at).toBeInstanceOf(Date);
  });

  it("runs a queued text export through the real worker and object store", async () => {
    const fixture = await insertProjectFixture(pool, "book");
    const document = createBookDocument(fixture);
    await new PostgresLayerDocumentRepository(pool).save(document);
    const repository = new PostgresExportRepository(pool);
    const job = createExportJob(fixture, {
      documentRevision: 1,
      format: "json",
      status: "queued",
    });
    await repository.save(job);
    const controller = new AbortController();
    const worker = runExportWorker(
      {
        databaseUrl: integrationEnvironment.databaseUrl,
        databasePoolMax: 3,
        objectStorage: {
          endpoint: integrationEnvironment.endpoint,
          region: "us-east-1",
          bucket: integrationEnvironment.bucket,
          accessKeyId: integrationEnvironment.accessKeyId,
          secretAccessKey: integrationEnvironment.secretAccessKey,
          forcePathStyle: true,
          encryptionMode: "none",
          requireVersioning: false,
        },
        pollMilliseconds: 25,
        concurrency: 1,
        leaseMilliseconds: 30_000,
        drainTimeoutMilliseconds: 5_000,
        sharpCacheMemoryMb: 16,
        sharpConcurrency: 1,
        workerId: `integration-export-${crypto.randomUUID()}`,
      },
      { signal: controller.signal },
    );

    let ready: ExportJob;
    try {
      ready = await waitFor(async () => {
        const current = await repository.findById(job.id);
        return current?.status === "ready" ? current : null;
      });
    } finally {
      controller.abort();
      await worker;
    }

    expect(ready.artifact?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    const key = `artifacts/${fixture.projectId}/${job.id}/${ready.artifact!.filename}`;
    const artifact = await storage.get(key);
    expect(artifact?.contentType).toBe("application/json");
    expect(JSON.parse(artifact!.body.toString("utf8"))).toMatchObject({
      projectId: fixture.projectId,
      sourceVersionId: fixture.sourceVersionId,
      revision: 1,
    });
    await storage.delete(key);
  });
});

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for durable integration tests.`);
  }
  return value;
}

interface ProjectFixture {
  projectId: string;
  sourceVersionId: string;
  projectKind: "image" | "book";
}

async function insertProjectFixture(
  pool: Pool,
  projectKind: ProjectFixture["projectKind"],
): Promise<ProjectFixture> {
  const userId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const sourceVersionId = crypto.randomUUID();
  const timestamp = "2026-07-28T09:00:00.000Z";
  await pool.query(
    `INSERT INTO users (
       id, name, email, role, status, password_hash, created_at
     )
     VALUES ($1, 'Integration User', $2, 'creator', 'active', 'hash', $3)`,
    [userId, `${userId}@example.test`, timestamp],
  );
  await pool.query(
    `INSERT INTO projects (
       id, owner_user_id, name, kind, status, created_at, updated_at
     )
     VALUES ($1, $2, 'Integration Project', $3, 'queued', $4, $4)`,
    [projectId, userId, projectKind, timestamp],
  );
  return { projectId, sourceVersionId, projectKind };
}

function createExportJob(
  fixture: ProjectFixture,
  overrides: Partial<ExportJob> = {},
): ExportJob {
  return {
    id: crypto.randomUUID(),
    projectId: fixture.projectId,
    sourceVersionId: fixture.sourceVersionId,
    projectKind: fixture.projectKind,
    format: "psd",
    scope: "full-document",
    scale: 1,
    colorProfile: "sRGB",
    namingPresetId: "adobe-default",
    status: "queued",
    progress: 0,
    attempt: 0,
    maxAttempts: 3,
    nextAttemptAt: "2026-07-28T09:00:00.000Z",
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCode: null,
    createdAt: "2026-07-28T09:00:00.000Z",
    updatedAt: "2026-07-28T09:00:00.000Z",
    ...overrides,
  };
}

function createProcessingJob(
  fixture: ProjectFixture,
  overrides: Partial<ProcessingJob> = {},
): ProcessingJob {
  return {
    id: crypto.randomUUID(),
    projectId: fixture.projectId,
    sourceVersionId: fixture.sourceVersionId,
    projectKind: fixture.projectKind,
    options: { pdfSeparationMode: "line" },
    status: "queued",
    progress: 0,
    attempt: 0,
    maxAttempts: 3,
    nextAttemptAt: "2026-07-28T09:00:00.000Z",
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCode: null,
    createdAt: "2026-07-28T09:00:00.000Z",
    updatedAt: "2026-07-28T09:00:00.000Z",
    ...overrides,
  };
}

function createBookDocument(fixture: ProjectFixture): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId: fixture.projectId,
    sourceVersionId: fixture.sourceVersionId,
    revision: 1,
    generatedAt: "2026-07-28T09:00:00.000Z",
    width: 320,
    height: 180,
    colorSpace: "sRGB",
    pages: [{ pageNumber: 1, width: 320, height: 180 }],
    layers: [
      {
        id: crypto.randomUUID(),
        parentId: null,
        kind: "raster",
        name: "+page_001_background",
        visible: true,
        locked: true,
        opacity: 1,
        fixed: true,
        zIndex: 0,
        pageNumber: 1,
        bounds: { x: 0, y: 0, width: 320, height: 180 },
        fillColor: "#ffffff",
      },
      {
        id: crypto.randomUUID(),
        parentId: null,
        kind: "text",
        name: "+integration_text",
        visible: true,
        locked: false,
        opacity: 1,
        fixed: false,
        zIndex: 1,
        pageNumber: 1,
        bounds: { x: 40, y: 30, width: 240, height: 30 },
        fullText: "اختبار عامل التصدير",
        readingOrder: 0,
        direction: "rtl",
      },
    ],
  };
}

function createSubscription(
  userId: string,
  overrides: Partial<SubscriptionView> = {},
): SubscriptionView {
  return {
    id: crypto.randomUUID(),
    userId,
    planId: "creator",
    status: "active",
    renewalAt: "2026-08-28T10:00:00.000Z",
    usage: {
      jobs: 4,
      jobLimit: 100,
      processingMinutes: 3,
      processingMinuteLimit: 600,
    },
    provider: "stripe",
    providerCustomerId: `cus_${crypto.randomUUID()}`,
    providerSubscriptionId: `sub_${crypto.randomUUID()}`,
    cancelAtPeriodEnd: false,
    ...overrides,
  };
}

function retentionConfig() {
  return {
    RETENTION_BATCH_SIZE: 10,
    RETENTION_RUN_INTERVAL_MINUTES: 60,
    JOB_RETENTION_DAYS: 90,
    AUDIT_RETENTION_DAYS: 400,
    USAGE_LEDGER_RETENTION_DAYS: 400,
    WORKER_HEARTBEAT_RETENTION_DAYS: 7,
    WORKER_EVENT_RETENTION_DAYS: 30,
  } as const;
}

async function waitFor<T>(
  probe: () => Promise<T | null>,
  timeoutMilliseconds = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the export worker.");
}
