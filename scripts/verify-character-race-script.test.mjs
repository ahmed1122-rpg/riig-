import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Character race gate cannot silently exclude its PostgreSQL suite", async () => {
  const manifest = JSON.parse(
    await readFile("apps/api/package.json", "utf8"),
  );
  const command = manifest.scripts?.["test:character-rig:race"] ?? "";
  assert.match(command, /character-job-executor\.test\.ts\s+&&/u);
  assert.match(command, /--config vitest\.integration\.config\.ts/u);
  assert.match(command, /postgres-character-rig\.integration\.test\.ts/u);
});
