import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertMigrationNames,
  migrationChecksum,
} from "./migration-integrity.js";

describe("migration integrity", () => {
  it("creates a stable SHA-256 checksum", () => {
    expect(migrationChecksum("SELECT 1;\n")).toMatch(/^[a-f0-9]{64}$/u);
    expect(migrationChecksum("SELECT 1;\n")).toBe(
      migrationChecksum("SELECT 1;\n"),
    );
    expect(migrationChecksum("SELECT 2;\n")).not.toBe(
      migrationChecksum("SELECT 1;\n"),
    );
  });

  it("rejects every duplicate migration identifier", () => {
    expect(() =>
      assertMigrationNames(["013_first.sql", "013_second.sql"]),
    ).toThrow(/prefix 013 is duplicated/u);
  });

  it("rejects names that cannot be ordered safely", () => {
    expect(() => assertMigrationNames(["14_bad.sql"])).toThrow(
      /NNN_description/u,
    );
  });

  it("keeps the checked-in migration sequence unique and additive", async () => {
    const directory = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../migrations",
    );
    const files = (await readdir(directory)).filter((filename) =>
      filename.endsWith(".sql"),
    );
    const sourceVersionMigration = await readFile(
      path.join(directory, "009_source_versions.sql"),
      "utf8",
    );
    const compatibilityMigration = await readFile(
      path.join(directory, "019_upload_url_compatibility.sql"),
      "utf8",
    );
    const sourceRestoreMigration = await readFile(
      path.join(directory, "021_source_version_restores.sql"),
      "utf8",
    );
    const documentRevisionMigration = await readFile(
      path.join(directory, "022_layer_document_revisions.sql"),
      "utf8",
    );

    expect(() => assertMigrationNames(files)).not.toThrow();
    expect(sourceVersionMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+COLUMN/iu,
    );
    expect(sourceVersionMigration).toContain("demo_upload_url");
    expect(sourceVersionMigration).toContain("upload_url");
    expect(compatibilityMigration).not.toMatch(
      /RENAME\s+COLUMN|DROP\s+COLUMN/iu,
    );
    expect(compatibilityMigration).toContain(
      "ADD COLUMN IF NOT EXISTS demo_upload_url",
    );
    expect(compatibilityMigration).toContain(
      "ADD COLUMN IF NOT EXISTS upload_url",
    );
    expect(sourceRestoreMigration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu);
    expect(sourceRestoreMigration).toContain(
      "CREATE TABLE IF NOT EXISTS source_version_restore_events",
    );
    expect(sourceRestoreMigration).toContain(
      "UNIQUE (actor_user_id, request_id)",
    );
    expect(documentRevisionMigration).not.toMatch(/DROP\s+(TABLE|COLUMN)/iu);
    expect(documentRevisionMigration).toContain(
      "CREATE TABLE IF NOT EXISTS layer_document_revisions",
    );
    expect(documentRevisionMigration).toContain(
      "PRIMARY KEY (project_id, source_version_id, revision)",
    );
  });
});
