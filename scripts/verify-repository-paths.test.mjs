import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { verifyRepositoryPaths } from "./verify-repository-paths.mjs";

const execFileAsync = promisify(execFile);

test("accepts tracked relative links and portable evidence paths", async () => {
  const root = await createRepository({
    "docs/index.md": "[Runbook](../artifacts/run.json)\n",
    "artifacts/run.json": '{"source":{"path":".tmp/input.pdf"}}\n',
  });

  assert.deepEqual(await verifyRepositoryPaths(root), []);
});

test("reports missing links and machine-specific evidence paths", async () => {
  const root = await createRepository({
    "docs/index.md": "![Missing](../artifacts/missing.png)\n",
    "artifacts/run.txt": "PREVIEW|C:\\Users\\developer\\preview.png\n",
  });

  const violations = await verifyRepositoryPaths(root);
  assert.equal(violations.length, 2);
  assert.ok(violations.some((violation) => /links to a missing path/u.test(violation)));
  assert.ok(
    violations.some((violation) => /machine-specific absolute path/u.test(violation)),
  );
});

test("checks untracked files and tolerates tracked files deleted in the worktree", async () => {
  const root = await createRepository({
    "docs/deleted.md": "Retired documentation.\n",
    "docs/index.md": "Current documentation.\n",
  });
  await writeFile(join(root, "docs", "untracked.md"), "[Missing](missing.md)\n");
  await rm(join(root, "docs", "deleted.md"));

  const violations = await verifyRepositoryPaths(root);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /docs\/untracked\.md:1 links to a missing path/u);
});

test("checks a source image without Git metadata and skips dependency output", async () => {
  const root = await mkdtemp(join(tmpdir(), "motionprep-paths-image-"));
  await mkdir(join(root, "docs"), { recursive: true });
  await mkdir(join(root, "node_modules", "fixture"), { recursive: true });
  await writeFile(
    join(root, "docs", "index.md"),
    "[Missing](missing.md)\n[Image-excluded evidence](../artifacts/report.md)\n",
  );
  await writeFile(
    join(root, "node_modules", "fixture", "README.md"),
    "[Dependency missing](missing.md)\n",
  );

  const violations = await verifyRepositoryPaths(root);
  assert.deepEqual(violations, [
    "docs/index.md:1 links to a missing path: missing.md",
  ]);
});

async function createRepository(files) {
  const root = await mkdtemp(join(tmpdir(), "motionprep-paths-"));
  for (const [relativePath, body] of Object.entries(files)) {
    const filename = join(root, relativePath);
    await mkdir(join(filename, ".."), { recursive: true });
    await writeFile(filename, body, "utf8");
  }
  await execFileAsync("git", ["init", "--quiet"], { cwd: root });
  await execFileAsync("git", ["add", "."], { cwd: root });
  return root;
}
