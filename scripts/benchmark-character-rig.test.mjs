import assert from "node:assert/strict";
import { test } from "node:test";

import {
  analyzePsd,
  validateBenchmarkManifest,
  verifyReferenceReport,
} from "./benchmark-character-rig.mjs";

const thresholds = {
  schemaVersion: 1,
  canonicalViews: [
    "frontal",
    "left-quarter",
    "left-profile",
    "right-quarter",
    "right-profile",
  ],
  targetExport: { colorMode: "RGB", bitsPerChannel: 8 },
};

const manifest = {
  schemaVersion: 1,
  reference: {
    role: "semantic-structure-reference",
    releaseGolden: false,
    rightsClassification: "user-provided-private-reference",
    binaryStoredInRepository: false,
    sizeBytes: 42,
    sha256: "a".repeat(64),
  },
  observed: {
    width: 100,
    height: 100,
    colorMode: 3,
    bitsPerChannel: 16,
    layerRecords: 3,
    groups: 1,
    leaves: 2,
    hiddenLayers: 1,
    masks: 1,
    maxDepth: 2,
    rootStoredOrder: ["+Character"],
    presentCanonicalViews: ["frontal", "left-quarter"],
  },
  target: {
    canonicalViews: thresholds.canonicalViews,
    colorMode: "RGB",
    bitsPerChannel: 8,
  },
};

test("analyzes hierarchy and canonical views without reading pixel data", () => {
  const report = analyzePsd({
    width: 100,
    height: 100,
    colorMode: 3,
    bitsPerChannel: 16,
    children: [
      {
        name: "+Character",
        children: [
          { name: "+frontal", mask: {} },
          { name: "+left quarter", hidden: true },
        ],
      },
    ],
  });

  assert.deepEqual(report, {
    width: 100,
    height: 100,
    colorMode: 3,
    bitsPerChannel: 16,
    layerRecords: 3,
    groups: 1,
    leaves: 2,
    hiddenLayers: 1,
    masks: 1,
    maxDepth: 2,
    rootStoredOrder: ["+Character"],
    rootPhotoshopPanelOrder: ["+Character"],
    presentCanonicalViews: ["frontal", "left-quarter"],
  });
});

test("accepts an incomplete private reference only as a non-Golden semantic fixture", () => {
  assert.deepEqual(validateBenchmarkManifest(manifest, thresholds), []);

  const unsafe = structuredClone(manifest);
  unsafe.reference.releaseGolden = true;
  assert.match(validateBenchmarkManifest(unsafe, thresholds).join("\n"), /must not be marked/u);
});

test("detects fingerprint and structural drift", () => {
  const report = {
    sizeBytes: 42,
    sha256: "a".repeat(64),
    observed: structuredClone(manifest.observed),
  };
  assert.deepEqual(verifyReferenceReport(report, manifest), []);

  report.observed.groups = 2;
  assert.match(verifyReferenceReport(report, manifest).join("\n"), /groups drifted/u);
});
