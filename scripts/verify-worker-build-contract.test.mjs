import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { verifyWorkerBuildContract } from "./verify-worker-build-contract.mjs";

test("accepts workers whose production build excludes tests", async () => {
  const root = await createWorker({
    build: "tsc -p tsconfig.build.json",
    buildConfig: { extends: "./tsconfig.json", exclude: ["src/**/*.test.ts"] },
  });
  assert.deepEqual(await verifyWorkerBuildContract(root), []);
});

test("rejects workers that compile tests into production", async () => {
  const root = await createWorker({
    build: "tsc -p tsconfig.json",
    buildConfig: { extends: "./tsconfig.json" },
  });
  assert.deepEqual(await verifyWorkerBuildContract(root), [
    "worker-demo must build with tsconfig.build.json so tests cannot enter the runtime image.",
  ]);
});

async function createWorker({ build, buildConfig }) {
  const root = await mkdtemp(join(tmpdir(), "motionprep-worker-build-"));
  const workerDirectory = join(root, "apps", "worker-demo");
  await mkdir(workerDirectory, { recursive: true });
  await writeFile(
    join(workerDirectory, "package.json"),
    JSON.stringify({ scripts: { build } }),
    "utf8",
  );
  await writeFile(
    join(workerDirectory, "tsconfig.build.json"),
    JSON.stringify(buildConfig),
    "utf8",
  );
  return root;
}
