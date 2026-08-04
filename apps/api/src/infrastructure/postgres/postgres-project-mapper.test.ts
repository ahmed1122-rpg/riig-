import { describe, expect, it } from "vitest";
import { mapPostgresProject } from "./postgres-project-mapper.js";

describe("PostgreSQL project mapping", () => {
  const row = {
    id: "project-1",
    name: "Project",
    kind: "image" as const,
    status: "draft" as const,
    current_source_version_id: "source-1",
    current_source_version_number: 2,
    created_at: new Date("2026-08-01T10:00:00.000Z"),
    updated_at: "2026-08-01T11:00:00.000Z",
  };

  it("maps database names and timestamps to the public contract", () => {
    expect(mapPostgresProject(row)).toEqual({
      id: "project-1",
      name: "Project",
      kind: "image",
      status: "draft",
      currentSourceVersionId: "source-1",
      currentSourceVersionNumber: 2,
      reviewApproval: null,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T11:00:00.000Z",
    });
  });

  it("accepts a transaction-owned source version override", () => {
    expect(mapPostgresProject(row, 7).currentSourceVersionNumber).toBe(7);
  });

  it("maps the current immutable review approval", () => {
    const approvedAt = new Date("2026-08-01T12:00:00.000Z");
    expect(
      mapPostgresProject({
        ...row,
        status: "approved",
        review_approval_id: "approval-1",
        review_project_id: "project-1",
        review_source_version_id: "source-1",
        review_document_revision: 4,
        review_actor_user_id: "user-1",
        review_operation_id: "approve-operation-1",
        review_approved_at: approvedAt,
      }).reviewApproval,
    ).toEqual({
      id: "approval-1",
      projectId: "project-1",
      sourceVersionId: "source-1",
      documentRevision: 4,
      actorUserId: "user-1",
      operationId: "approve-operation-1",
      approvedAt: approvedAt.toISOString(),
    });
  });
});
