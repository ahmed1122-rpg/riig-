import type { ProcessingJob } from "@motionprep/contracts";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { claimNextProcessingJob } from "./postgres-processing-job-claim.js";
import { PostgresProcessingJobRepository } from "./postgres-processing-repository.js";
import { PostgresExportRepository } from "./postgres-export-repository.js";
import { PostgresProjectRepository } from "./postgres-project-repository.js";
import { PostgresSourceVersionRestoreCommand } from "./postgres-source-version-restore.js";

describe("PostgreSQL job and source transaction contracts", () => {
  it("rolls back the project fence when processing INSERT faults", async () => {
    const fixture = processingFixture();
    const statements: string[] = [];
    const client = fakeClient(async (sql) => {
      statements.push(sql);
      if (sql.includes("UPDATE projects AS project")) return result([], 1);
      return result([]);
    });
    const repository = new PostgresProcessingJobRepository(fakePool(client));
    const circularOptions: Record<string, unknown> = {};
    circularOptions.self = circularOptions;

    await expect(
      repository.enqueue({
        ...fixture.job,
        options: circularOptions as ProcessingJob["options"],
      }),
    ).rejects.toThrow();
    expect(statements).toContain("BEGIN");
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
    expect(
      statements.find((sql) => sql.includes("UPDATE projects AS project")),
    ).toContain("active_upload");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("keeps a late generic status update from clearing a project job fence", async () => {
    const statements: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql.trim());
        return result([], 0);
      }),
    } as unknown as Pool;
    const repository = new PostgresProjectRepository(pool);

    await expect(
      repository.updateStatus(crypto.randomUUID(), "uploading"),
    ).resolves.toBeNull();
    expect(statements[0]).toContain("active_job_id IS NULL");
  });

  it("rolls back a claimed processing job when the fence CAS fails", async () => {
    const fixture = processingFixture();
    const statements: string[] = [];
    const client = fakeClient(async (sql) => {
      statements.push(sql);
      if (sql.includes("WORKER_LEASE_EXHAUSTED")) return result([]);
      if (sql.includes("WITH candidate AS")) {
        return result([
          {
            id: fixture.job.id,
            project_id: fixture.job.projectId,
            source_version_id: fixture.job.sourceVersionId,
            project_kind: "image",
            options: {},
            status: "processing",
            progress: 25,
            attempt: 1,
            max_attempts: 3,
            next_attempt_at: fixture.now,
            lease_owner: "worker",
            lease_expires_at: fixture.now,
            error_code: null,
            correlation_id: null,
            trace_parent: null,
            trace_state: null,
            created_at: fixture.now,
            updated_at: fixture.now,
          },
        ]);
      }
      if (sql.includes("UPDATE projects")) return result([], 0);
      return result([]);
    });

    await expect(
      claimNextProcessingJob(fakePool(client), "image", "worker", 60_000),
    ).resolves.toBeNull();
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });

  it("does not write a restore event when the locked project is busy", async () => {
    const actorUserId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const sourceVersionId = crypto.randomUUID();
    const statements: string[] = [];
    const client = fakeClient(async (sql) => {
      statements.push(sql);
      if (sql.includes("source_version_restore_events") && sql.includes("SELECT")) {
        return result([]);
      }
      if (sql.includes("FROM projects") && sql.includes("FOR UPDATE")) {
        return result([
          {
            id: projectId,
            name: "Busy project",
            kind: "image",
            status: "processing",
            current_source_version_id: sourceVersionId,
            active_job_id: crypto.randomUUID(),
            created_at: "2026-08-13T00:00:00.000Z",
            updated_at: "2026-08-13T00:00:00.000Z",
          },
        ]);
      }
      if (sql.includes("SELECT version_number FROM source_versions")) {
        return result([{ version_number: 2 }]);
      }
      return result([]);
    });
    const command = new PostgresSourceVersionRestoreCommand(fakePool(client));

    await expect(
      command.restore({
        projectId,
        actorUserId,
        targetSourceVersionId: crypto.randomUUID(),
        expectedCurrentSourceVersionId: sourceVersionId,
        reason: "Busy restore must fail.",
        idempotencyKey: "busy-restore-transaction-test",
        originatingRequestId: crypto.randomUUID(),
      }),
    ).rejects.toMatchObject({ code: "SOURCE_VERSION_BUSY" });
    expect(statements).toContain("ROLLBACK");
    expect(
      statements.some(
        (sql) =>
          sql.includes("INSERT INTO source_version_restore_events") ||
          (sql.includes("UPDATE projects") &&
            sql.includes("current_source_version_id")),
      ),
    ).toBe(false);
  });

  it("does not restore a source while an upload intent is active", async () => {
    const actorUserId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const sourceVersionId = crypto.randomUUID();
    const statements: string[] = [];
    const client = fakeClient(async (sql) => {
      statements.push(sql);
      if (sql.includes("source_version_restore_events") && sql.includes("SELECT")) {
        return result([]);
      }
      if (sql.includes("FROM projects") && sql.includes("FOR UPDATE")) {
        return result([{
          id: projectId,
          name: "Uploading project",
          kind: "image",
          status: "needs_review",
          current_source_version_id: sourceVersionId,
          active_job_id: null,
          created_at: "2026-08-13T00:00:00.000Z",
          updated_at: "2026-08-13T00:00:00.000Z",
        }]);
      }
      if (sql.includes("SELECT version_number FROM source_versions")) {
        return result([{ version_number: 2 }]);
      }
      if (sql.includes("AS busy")) return result([{ busy: true }]);
      return result([]);
    });
    const command = new PostgresSourceVersionRestoreCommand(fakePool(client));

    await expect(command.restore({
      projectId,
      actorUserId,
      targetSourceVersionId: crypto.randomUUID(),
      expectedCurrentSourceVersionId: sourceVersionId,
      reason: "Active upload must win the restore race.",
      idempotencyKey: "upload-busy-restore-transaction-test",
      originatingRequestId: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "SOURCE_VERSION_BUSY" });

    expect(statements).toContain("ROLLBACK");
    expect(statements.filter((sql) => sql.includes("pg_advisory_xact_lock")))
      .toHaveLength(2);
    expect(statements.some((sql) => sql.startsWith("UPDATE projects"))).toBe(false);
    expect(statements.some((sql) =>
      sql.includes("INSERT INTO source_version_restore_events"),
    )).toBe(false);
  });

  it("rechecks upload and current-source fences in the restore CAS", async () => {
    const actorUserId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const currentSourceVersionId = crypto.randomUUID();
    const targetSourceVersionId = crypto.randomUUID();
    const statements: string[] = [];
    const client = fakeClient(async (sql) => {
      statements.push(sql);
      if (sql.includes("source_version_restore_events") && sql.includes("SELECT")) {
        return result([]);
      }
      if (sql.includes("FROM projects") && sql.includes("FOR UPDATE")) {
        return result([{
          id: projectId,
          name: "Restorable project",
          kind: "image",
          status: "needs_review",
          current_source_version_id: currentSourceVersionId,
          active_job_id: null,
          created_at: "2026-08-13T00:00:00.000Z",
          updated_at: "2026-08-13T00:00:00.000Z",
        }]);
      }
      if (sql.includes("SELECT version_number FROM source_versions")) {
        return result([{ version_number: 2 }]);
      }
      if (sql.includes("AS busy")) return result([{ busy: false }]);
      if (sql.includes("SELECT id, version_number, status")) {
        return result([{ id: targetSourceVersionId, version_number: 1, status: "ready" }]);
      }
      if (sql.startsWith("UPDATE projects")) return result([], 0);
      return result([]);
    });
    const command = new PostgresSourceVersionRestoreCommand(fakePool(client));

    await expect(command.restore({
      projectId,
      actorUserId,
      targetSourceVersionId,
      expectedCurrentSourceVersionId: currentSourceVersionId,
      reason: "CAS must recheck upload fences.",
      idempotencyKey: "restore-cas-upload-fence-test",
      originatingRequestId: crypto.randomUUID(),
    })).rejects.toMatchObject({ code: "SOURCE_VERSION_BUSY" });

    const update = statements.find((sql) => sql.startsWith("UPDATE projects"));
    expect(update).toContain("current_source_version_id = $3");
    expect(update).toContain("active_upload");
    expect(update).toContain("active_source");
    expect(statements).toContain("ROLLBACK");
  });

  it("rolls back a ready export when terminal project settlement loses its CAS", async () => {
    const fixture = processingFixture();
    const statements: string[] = [];
    const client = fakeClient(async (sql) => {
      statements.push(sql);
      if (sql.startsWith("UPDATE export_jobs AS job")) {
        return result([
          {
            id: fixture.job.id,
            project_id: fixture.job.projectId,
            source_version_id: fixture.job.sourceVersionId,
            document_revision: 1,
            project_kind: "image",
            format: "psd",
            scope: "full-document",
            selected_page: null,
            scale: 1,
            color_profile: "sRGB",
            naming_preset_id: "adobe-default",
            artifact: null,
            status: "ready",
            progress: 100,
            attempt: 1,
            max_attempts: 3,
            next_attempt_at: fixture.now,
            lease_owner: null,
            lease_expires_at: null,
            error_code: null,
            correlation_id: null,
            trace_parent: null,
            trace_state: null,
            created_at: fixture.now,
            updated_at: fixture.now,
          },
        ]);
      }
      if (sql.startsWith("UPDATE projects")) return result([], 0);
      return result([]);
    });
    const repository = new PostgresExportRepository(fakePool(client));

    await expect(
      repository.settleClaim(
        fixture.job.id,
        "export-worker",
        { status: "ready", progress: 100, leaseOwner: null },
        fixture.now,
      ),
    ).resolves.toBeNull();
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });

  it("requires the current review approval when retrying a failed export", async () => {
    const statements: string[] = [];
    const client = fakeClient(async (sql) => {
      statements.push(sql);
      return result([], 0);
    });
    const repository = new PostgresExportRepository(fakePool(client));

    await expect(
      repository.retryFailed(crypto.randomUUID(), "2026-08-13T00:00:00.000Z"),
    ).resolves.toBeNull();
    expect(
      statements.find((sql) => sql.startsWith("UPDATE export_jobs AS job")),
    ).toContain("project_review_approvals");
    expect(statements).toContain("ROLLBACK");
  });
});

function processingFixture() {
  const now = "2026-08-13T00:00:00.000Z";
  return {
    now,
    job: {
      id: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      sourceVersionId: crypto.randomUUID(),
      projectKind: "image" as const,
      options: {},
      status: "queued" as const,
      progress: 0,
      attempt: 0,
      maxAttempts: 3,
      nextAttemptAt: now,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      createdAt: now,
      updatedAt: now,
    },
  };
}

function fakePool(client: ReturnType<typeof fakeClient>): Pool {
  return { connect: vi.fn(async () => client) } as unknown as Pool;
}

function fakeClient(
  responder: (sql: string) => Promise<{ rows: unknown[]; rowCount: number }>,
) {
  return {
    query: vi.fn(async (statement: string) => responder(statement.trim())),
    release: vi.fn(),
  };
}

function result(rows: unknown[], rowCount = rows.length) {
  return { rows, rowCount };
}
