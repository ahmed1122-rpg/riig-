import type { ExportJob, LayerDocument } from "@motionprep/contracts";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ProjectReviewDomainError } from "../../projects/project-review.js";
import { PostgresLayerDocumentRepository } from "./postgres-processing-repository.js";
import { PostgresExportRepository } from "./postgres-export-repository.js";
import { PostgresProjectRepository } from "./postgres-project-repository.js";
import { PostgresProjectReviewCommand } from "./postgres-project-review.js";

const databaseUrl = requireEnvironment("INTEGRATION_DATABASE_URL");

describe("PostgreSQL project review lifecycle", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 4 });
    await pool.query("SELECT 1");
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE users CASCADE");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("persists an idempotent approval and invalidates it atomically on edit", async () => {
    const fixture = await insertFixture(pool);
    const documents = new PostgresLayerDocumentRepository(pool);
    const reviews = new PostgresProjectReviewCommand(pool);
    const projects = new PostgresProjectRepository(pool);
    const document = createDocument(fixture.projectId, fixture.sourceVersionId, 2);
    await documents.save(document);
    const input = {
      projectId: fixture.projectId,
      sourceVersionId: fixture.sourceVersionId,
      documentRevision: 2,
      actorUserId: fixture.ownerId,
      operationId: "postgres-review-operation-001",
    };

    const approved = await reviews.approve(input);
    const replayed = await reviews.approve(input);

    expect(approved).toMatchObject({
      replayed: false,
      project: { status: "approved" },
      approval: {
        sourceVersionId: fixture.sourceVersionId,
        documentRevision: 2,
      },
    });
    expect(replayed).toMatchObject({
      replayed: true,
      approval: { id: approved.approval.id },
    });
    await expect(
      documents.saveIfRevision(
        createDocument(fixture.projectId, fixture.sourceVersionId, 3),
        2,
      ),
    ).resolves.toBe(true);
    await expect(
      projects.findOwnedById(fixture.ownerId, fixture.projectId),
    ).resolves.toMatchObject({
      status: "needs_review",
      reviewApproval: null,
    });
  });

  it("never leaves an approval pinned to a revision racing with a mutation", async () => {
    const fixture = await insertFixture(pool);
    const documents = new PostgresLayerDocumentRepository(pool);
    const reviews = new PostgresProjectReviewCommand(pool);
    const projects = new PostgresProjectRepository(pool);
    await documents.save(
      createDocument(fixture.projectId, fixture.sourceVersionId, 4),
    );

    const [approval, mutation] = await Promise.allSettled([
      reviews.approve({
        projectId: fixture.projectId,
        sourceVersionId: fixture.sourceVersionId,
        documentRevision: 4,
        actorUserId: fixture.ownerId,
        operationId: "postgres-review-race-001",
      }),
      documents.saveIfRevision(
        createDocument(fixture.projectId, fixture.sourceVersionId, 5),
        4,
      ),
    ]);

    expect(mutation).toMatchObject({ status: "fulfilled", value: true });
    if (approval.status === "rejected") {
      expect(approval.reason).toBeInstanceOf(ProjectReviewDomainError);
      expect(approval.reason).toMatchObject({
        code: "REVIEW_REVISION_CONFLICT",
      });
    }
    await expect(
      projects.findOwnedById(fixture.ownerId, fixture.projectId),
    ).resolves.toMatchObject({
      status: "needs_review",
      reviewApproval: null,
    });
  });

  it("retains a historical layer revision while an export job pins it", async () => {
    const fixture = await insertFixture(pool);
    const documents = new PostgresLayerDocumentRepository(pool);
    const exports = new PostgresExportRepository(pool);
    await documents.save(
      createDocument(fixture.projectId, fixture.sourceVersionId, 1),
    );
    const exportJob = createExportJob(fixture.projectId, fixture.sourceVersionId);
    await exports.save(exportJob);

    await documents.save(
      createDocument(fixture.projectId, fixture.sourceVersionId, 102),
    );

    await expect(
      documents.findRevision(fixture.projectId, fixture.sourceVersionId, 1),
    ).resolves.toMatchObject({ revision: 1 });

    await pool.query("DELETE FROM export_jobs WHERE id = $1", [exportJob.id]);
    await documents.save(
      createDocument(fixture.projectId, fixture.sourceVersionId, 103),
    );
    await expect(
      documents.findRevision(fixture.projectId, fixture.sourceVersionId, 1),
    ).resolves.toBeNull();
  });
});

async function insertFixture(pool: Pool) {
  const ownerId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const sourceVersionId = crypto.randomUUID();
  const uploadId = crypto.randomUUID();
  const timestamp = "2026-08-03T12:00:00.000Z";
  await pool.query(
    `INSERT INTO users (
       id, name, email, role, status, password_hash, created_at
     ) VALUES ($1, 'Review Owner', $2, 'creator', 'active', 'hash', $3)`,
    [ownerId, `${ownerId}@example.test`, timestamp],
  );
  await pool.query(
    `INSERT INTO projects (
       id, owner_user_id, name, kind, status, created_at, updated_at
     ) VALUES ($1, $2, 'Review Project', 'image', 'needs_review', $3, $3)`,
    [projectId, ownerId, timestamp],
  );
  await pool.query(
    `INSERT INTO source_versions (
       id, project_id, upload_id, version_number, filename, content_type,
       size_bytes, status, sha256, created_at, updated_at
     ) VALUES (
       $1, $2, $3, 1, 'source.png', 'image/png', 64, 'ready', $4, $5, $5
     )`,
    [sourceVersionId, projectId, uploadId, "a".repeat(64), timestamp],
  );
  await pool.query(
    "UPDATE projects SET current_source_version_id = $2 WHERE id = $1",
    [projectId, sourceVersionId],
  );
  return { ownerId, projectId, sourceVersionId };
}

function createDocument(
  projectId: string,
  sourceVersionId: string,
  revision: number,
): LayerDocument {
  return {
    schemaVersion: "1.0",
    projectId,
    sourceVersionId,
    revision,
    generatedAt: "2026-08-03T12:00:00.000Z",
    width: 320,
    height: 180,
    colorSpace: "sRGB",
    layers: [
      {
        id: crypto.randomUUID(),
        parentId: null,
        kind: "raster",
        name: "+source",
        visible: true,
        locked: false,
        opacity: 1,
        fixed: false,
        zIndex: 0,
      },
    ],
  };
}

function createExportJob(
  projectId: string,
  sourceVersionId: string,
): ExportJob {
  return {
    id: crypto.randomUUID(),
    projectId,
    sourceVersionId,
    documentRevision: 1,
    projectKind: "image",
    format: "psd",
    scope: "full-document",
    scale: 1,
    colorProfile: "sRGB",
    namingPresetId: "adobe-default",
    status: "queued",
    progress: 0,
    attempt: 0,
    maxAttempts: 3,
    nextAttemptAt: "2026-08-03T12:00:00.000Z",
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCode: null,
    createdAt: "2026-08-03T12:00:00.000Z",
    updatedAt: "2026-08-03T12:00:00.000Z",
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests.`);
  return value;
}
