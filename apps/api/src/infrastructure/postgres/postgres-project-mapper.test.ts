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
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T11:00:00.000Z",
    });
  });

  it("accepts a transaction-owned source version override", () => {
    expect(mapPostgresProject(row, 7).currentSourceVersionNumber).toBe(7);
  });
});
