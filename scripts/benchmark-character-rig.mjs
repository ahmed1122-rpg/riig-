import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { readPsd } from "ag-psd";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultManifestPath = join(
  root,
  "artifacts",
  "benchmarks",
  "character-rig",
  "reference-manifest.json",
);
const defaultThresholdsPath = join(
  root,
  "config",
  "character-rig-quality-thresholds.json",
);

const canonicalViewAliases = new Map([
  ["frontal", "frontal"],
  ["front", "frontal"],
  ["left quarter", "left-quarter"],
  ["left 3 4", "left-quarter"],
  ["left profile", "left-profile"],
  ["right quarter", "right-quarter"],
  ["right 3 4", "right-quarter"],
  ["right profile", "right-profile"],
]);

export function analyzePsd(psd) {
  const metrics = {
    layerRecords: 0,
    groups: 0,
    leaves: 0,
    hiddenLayers: 0,
    masks: 0,
    maxDepth: 0,
  };
  const presentCanonicalViews = new Set();

  function visit(layer, depth) {
    metrics.layerRecords += 1;
    metrics.maxDepth = Math.max(metrics.maxDepth, depth);
    if (layer.hidden === true) metrics.hiddenLayers += 1;
    if (layer.mask !== undefined || layer.vectorMask !== undefined) metrics.masks += 1;

    const canonicalView = canonicalViewFromName(layer.name);
    if (canonicalView !== undefined) presentCanonicalViews.add(canonicalView);

    if (Array.isArray(layer.children)) {
      metrics.groups += 1;
      for (const child of layer.children) visit(child, depth + 1);
    } else {
      metrics.leaves += 1;
    }
  }

  const rootLayers = psd.children ?? [];
  for (const layer of rootLayers) visit(layer, 1);

  return {
    width: psd.width,
    height: psd.height,
    colorMode: psd.colorMode,
    bitsPerChannel: psd.bitsPerChannel,
    ...metrics,
    rootStoredOrder: rootLayers.map((layer) => layer.name ?? ""),
    rootPhotoshopPanelOrder: [...rootLayers]
      .reverse()
      .map((layer) => layer.name ?? ""),
    presentCanonicalViews: [...presentCanonicalViews].sort(),
  };
}

export function validateBenchmarkManifest(manifest, thresholds) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push("Unsupported manifest schemaVersion.");
  if (thresholds?.schemaVersion !== 1) errors.push("Unsupported threshold schemaVersion.");
  if (manifest?.reference?.role !== "semantic-structure-reference") {
    errors.push("Reference role must be semantic-structure-reference.");
  }
  if (manifest?.reference?.releaseGolden !== false) {
    errors.push("The incomplete private reference must not be marked as a release Golden.");
  }
  if (manifest?.reference?.rightsClassification !== "user-provided-private-reference") {
    errors.push("Reference rights classification is missing or unsupported.");
  }
  if (manifest?.reference?.binaryStoredInRepository !== false) {
    errors.push("The private reference binary must not be stored in the repository.");
  }
  if (!/^[a-f\d]{64}$/u.test(manifest?.reference?.sha256 ?? "")) {
    errors.push("Reference sha256 must be a lowercase SHA-256 digest.");
  }
  if (!Number.isSafeInteger(manifest?.reference?.sizeBytes) || manifest.reference.sizeBytes <= 0) {
    errors.push("Reference sizeBytes must be a positive integer.");
  }

  const requiredViews = thresholds?.canonicalViews;
  if (!isUniqueStringArray(requiredViews) || requiredViews.length !== 5) {
    errors.push("Quality thresholds must declare five unique canonical views.");
  }
  if (JSON.stringify(manifest?.target?.canonicalViews) !== JSON.stringify(requiredViews)) {
    errors.push("Manifest target views must match the versioned quality thresholds.");
  }
  const observedViews = manifest?.observed?.presentCanonicalViews;
  if (!isUniqueStringArray(observedViews)) {
    errors.push("Observed canonical views must be a unique string array.");
  } else if (Array.isArray(requiredViews)) {
    for (const view of observedViews) {
      if (!requiredViews.includes(view)) errors.push(`Observed unknown canonical view: ${view}.`);
    }
  }
  if (manifest?.target?.bitsPerChannel !== thresholds?.targetExport?.bitsPerChannel) {
    errors.push("Manifest bit-depth target must match the quality thresholds.");
  }
  if (manifest?.target?.colorMode !== thresholds?.targetExport?.colorMode) {
    errors.push("Manifest color-mode target must match the quality thresholds.");
  }

  for (const [name, value] of Object.entries(manifest?.observed ?? {})) {
    if (
      !["rootStoredOrder", "presentCanonicalViews"].includes(name) &&
      (!Number.isSafeInteger(value) || value < 0)
    ) {
      errors.push(`Observed metric ${name} must be a non-negative integer.`);
    }
  }

  return errors;
}

export function verifyReferenceReport(report, manifest) {
  const errors = [];
  if (report.sizeBytes !== manifest.reference.sizeBytes) errors.push("Reference size drifted.");
  if (report.sha256 !== manifest.reference.sha256) errors.push("Reference SHA-256 drifted.");

  for (const [name, expected] of Object.entries(manifest.observed)) {
    const actual = report.observed[name];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      errors.push(`Observed ${name} drifted: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}.`);
    }
  }
  return errors;
}

function canonicalViewFromName(name) {
  const normalized = String(name ?? "")
    .toLowerCase()
    .replace(/^\s*\++/u, "")
    .replace(/[_-]+/gu, " ")
    .replace(/[^a-z\d\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return canonicalViewAliases.get(normalized);
}

function isUniqueStringArray(value) {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && entry.length > 0) &&
    new Set(value).size === value.length
  );
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function createReferenceReport(inputPath) {
  const absolutePath = resolve(inputPath);
  const [body, fileStats] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
  const psd = readPsd(body, {
    skipCompositeImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
    skipLinkedFilesData: true,
  });
  return {
    sizeBytes: fileStats.size,
    sha256: createHash("sha256").update(body).digest("hex"),
    observed: analyzePsd(psd),
  };
}

function parseArguments(argv) {
  const args = new Set(argv);
  const inputIndex = argv.indexOf("--input");
  return {
    verifyManifest: args.has("--verify-manifest"),
    verifyReference: args.has("--verify-reference"),
    summary: args.has("--summary"),
    input: inputIndex >= 0 ? argv[inputIndex + 1] : process.env.CHARACTER_RIG_REFERENCE_PSD,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [manifest, thresholds] = await Promise.all([
    readJson(defaultManifestPath),
    readJson(defaultThresholdsPath),
  ]);
  const manifestErrors = validateBenchmarkManifest(manifest, thresholds);
  if (manifestErrors.length > 0) throw new Error(manifestErrors.join("\n"));

  if (options.verifyReference) {
    if (!options.input) {
      throw new Error(
        "Set CHARACTER_RIG_REFERENCE_PSD or pass --input to verify the authorized private reference.",
      );
    }
    const report = await createReferenceReport(options.input);
    const reportErrors = verifyReferenceReport(report, manifest);
    if (reportErrors.length > 0) throw new Error(reportErrors.join("\n"));
    if (options.summary) console.log(JSON.stringify(report, undefined, 2));
    console.log("Character-rig private reference fingerprint and structure are valid.");
    return;
  }

  if (!options.verifyManifest) {
    throw new Error("Use --verify-manifest or --verify-reference.");
  }
  console.log("Character-rig benchmark manifest and quality thresholds are valid.");
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
