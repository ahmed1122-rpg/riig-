import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertOpenedHoldoutPolicy,
  computeOcrImplementationDigest,
  computeOcrHoldoutContentDigest,
  OCR_IMPLEMENTATION_FILES,
} from "./ocr-holdout-policy.mjs";

const digest = "a".repeat(64);
const contentDigest = "c".repeat(64);
const openedPolicy = {
  holdoutGeneration: 2,
  holdoutSourceIds: ["source-a", "source-b"],
  retiredHoldoutSourceIds: [],
  implementationFiles: OCR_IMPLEMENTATION_FILES,
  openedAt: "2026-07-30T00:00:00.000Z",
  implementationSha256: digest,
  holdoutContentSha256: contentDigest,
};

test("implementation digest covers the production OCR engine", async (t) => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "ocr-policy-"));
  t.after(() => rm(repositoryRoot, { recursive: true, force: true }));
  for (const relativePath of OCR_IMPLEMENTATION_FILES) {
    const absolutePath = join(repositoryRoot, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `fixture:${relativePath}\n`, "utf8");
  }

  assert.ok(
    OCR_IMPLEMENTATION_FILES.includes(
      "packages/document-processing/src/pdf-ocr.ts",
    ),
  );
  assert.ok(
    OCR_IMPLEMENTATION_FILES.includes(
      "packages/document-processing/src/ocr-pipeline.ts",
    ),
  );
  assert.ok(
    OCR_IMPLEMENTATION_FILES.includes(
      "packages/document-processing/src/ocr-review.ts",
    ),
  );
  const before = await computeOcrImplementationDigest(repositoryRoot);
  await writeFile(
    join(repositoryRoot, "packages/document-processing/src/pdf-ocr.ts"),
    "changed production engine\n",
    "utf8",
  );

  assert.notEqual(
    await computeOcrImplementationDigest(repositoryRoot),
    before,
  );
});

test("accepts an opened holdout pinned to the current implementation", () => {
  assert.doesNotThrow(() =>
    assertOpenedHoldoutPolicy(openedPolicy, digest, contentDigest),
  );
});

test("rejects a sealed holdout", () => {
  assert.throws(
    () =>
      assertOpenedHoldoutPolicy(
        {
          ...openedPolicy,
          openedAt: null,
          implementationSha256: null,
        },
        digest,
        contentDigest,
      ),
    /sealed/u,
  );
});

test("rejects implementation drift after opening", () => {
  assert.throws(
    () =>
      assertOpenedHoldoutPolicy(
        openedPolicy,
        "b".repeat(64),
        contentDigest,
      ),
    /changed after the holdout was opened/u,
  );
});

test("rejects changes to the protected implementation boundary", () => {
  assert.throws(
    () =>
      assertOpenedHoldoutPolicy(
        {
          ...openedPolicy,
          implementationFiles: OCR_IMPLEMENTATION_FILES.slice(1),
        },
        digest,
        contentDigest,
      ),
    /implementation boundary changed/u,
  );
});

test("rejects holdout content drift after opening", () => {
  assert.throws(
    () =>
      assertOpenedHoldoutPolicy(
        openedPolicy,
        digest,
        "d".repeat(64),
      ),
    /content changed after it was opened/u,
  );
});

test("holdout content digest ignores development samples and key order", () => {
  const manifest = {
    schemaVersion: 1,
    corpusId: "corpus",
    language: "ara",
    evaluationPolicy: {
      holdoutGeneration: 4,
      holdoutSourceIds: ["source-b", "source-a"],
    },
    referenceText: { license: "CC BY-SA 4.0" },
    acceptance: { maximum: 0.25 },
    samples: [
      {
        id: "holdout-b",
        sourceFile: { id: "source-b" },
        reference: { sha256: "b" },
      },
      {
        id: "development",
        sourceFile: { id: "source-c" },
        reference: { sha256: "ignored" },
      },
      {
        reference: { sha256: "a" },
        sourceFile: { id: "source-a" },
        id: "holdout-a",
      },
    ],
  };
  const reordered = {
    ...manifest,
    samples: [
      manifest.samples[2],
      { ...manifest.samples[1], reference: { sha256: "changed" } },
      manifest.samples[0],
    ],
  };

  assert.equal(
    computeOcrHoldoutContentDigest(manifest),
    computeOcrHoldoutContentDigest(reordered),
  );
  assert.notEqual(
    computeOcrHoldoutContentDigest(manifest),
    computeOcrHoldoutContentDigest({
      ...manifest,
      samples: manifest.samples.map((sample) =>
        sample.id === "holdout-a"
          ? { ...sample, reference: { sha256: "changed" } }
          : sample,
      ),
    }),
  );
});
