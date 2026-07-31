import assert from "node:assert/strict";
import test from "node:test";
import {
  assertOpenedHoldoutPolicy,
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
