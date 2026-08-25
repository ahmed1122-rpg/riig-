import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  packageReleaseGateEvidence,
  verifyReleaseGateEvidence,
} from "./package-release-gate-evidence.mjs";

test("packages a visible deterministic artifact layout and verifies every digest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "motionprep-gate-evidence-"));
  const sourceA = join(directory, "a.json");
  const sourceB = join(directory, "b.env");
  const output = join(directory, "packaged");
  await writeFile(sourceA, '{"passed":true}\n', "utf8");
  await writeFile(sourceB, "RELEASE_GIT_SHA=abc\n", "utf8");
  const manifest = await packageReleaseGateEvidence(output, [sourceB, sourceA]);
  assert.deepEqual(manifest.files.map((entry) => entry.name), ["a.json", "b.env"]);
  await verifyReleaseGateEvidence(output, ["a.json", "b.env"]);

  await writeFile(join(output, "a.json"), '{"passed":false}\n', "utf8");
  await assert.rejects(
    verifyReleaseGateEvidence(output, ["a.json", "b.env"]),
    /integrity verification/u,
  );
  assert.match(await readFile(join(output, "artifact-manifest.json"), "utf8"), /sha256/u);
});

test("rejects duplicate basenames and unexpected layouts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "motionprep-gate-layout-"));
  const left = join(directory, "left", "evidence.json");
  const right = join(directory, "right", "evidence.json");
  await assert.rejects(
    packageReleaseGateEvidence(join(directory, "output"), [left, right]),
    /unique source basenames/u,
  );

  const source = join(directory, "single.json");
  const output = join(directory, "packaged");
  await writeFile(source, "{}\n", "utf8");
  await packageReleaseGateEvidence(output, [source]);
  await writeFile(join(output, "unexpected.txt"), "not declared\n", "utf8");
  await assert.rejects(
    verifyReleaseGateEvidence(output, ["single.json"]),
    /unexpected files/u,
  );
});
