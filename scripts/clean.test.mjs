import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("clean refuses tracked build output and preserves source data", async () => {
  const root = await mkdtemp(join(tmpdir(), "motionprep-clean-"));
  await Promise.all([
    mkdir(join(root, "scripts"), { recursive: true }),
    mkdir(join(root, "apps/demo/dist"), { recursive: true }),
    mkdir(join(root, "apps/demo/src/data"), { recursive: true }),
    mkdir(join(root, "packages"), { recursive: true }),
  ]);
  await cp(new URL("./clean.mjs", import.meta.url), join(root, "scripts/clean.mjs"));
  await writeFile(join(root, "apps/demo/dist/tracked.txt"), "tracked");
  await writeFile(join(root, "apps/demo/src/data/user.json"), "{}");
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync(
    "git",
    ["add", "apps/demo/dist/tracked.txt", "apps/demo/src/data/user.json"],
    { cwd: root },
  );

  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/clean.mjs"], { cwd: root }),
    /Refusing to delete tracked files/u,
  );
  await access(join(root, "apps/demo/dist/tracked.txt"));
  await access(join(root, "apps/demo/src/data/user.json"));
});
