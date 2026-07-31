import { createHash } from "node:crypto";

export function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export function assertMigrationNames(files: readonly string[]): void {
  const byPrefix = new Map<string, string[]>();
  for (const filename of files) {
    const match = /^(\d{3})_[a-z0-9_]+\.sql$/u.exec(filename);
    if (!match) {
      throw new Error(
        `Migration filename ${filename} must match NNN_description.sql.`,
      );
    }
    const prefix = match[1]!;
    const entries = byPrefix.get(prefix) ?? [];
    entries.push(filename);
    byPrefix.set(prefix, entries);
  }

  for (const [prefix, entries] of byPrefix) {
    if (entries.length < 2) continue;
    throw new Error(
      `Migration prefix ${prefix} is duplicated by: ${entries.join(", ")}.`,
    );
  }
}
