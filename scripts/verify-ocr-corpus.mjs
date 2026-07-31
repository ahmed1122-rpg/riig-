import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { normalizeArabic } from "./ocr-benchmark-utils.mjs";
import {
  assertOpenedHoldoutPolicy,
  computeOcrImplementationDigest,
  computeOcrHoldoutContentDigest,
  OCR_IMPLEMENTATION_FILES,
} from "./ocr-holdout-policy.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const corpusDirectory = join(
  repositoryRoot,
  "artifacts",
  "benchmarks",
  "ocr-arabic-corpus",
);
const sources = JSON.parse(
  await readFile(join(corpusDirectory, "sources.json"), "utf8"),
);
const manifest = JSON.parse(
  await readFile(join(corpusDirectory, "manifest.json"), "utf8"),
);
const violations = [];
const expectedQualityLabels = new Map([
  [3, "community-proofread"],
  [4, "community-validated"],
]);

if (manifest.schemaVersion !== 1 || sources.schemaVersion !== 1) {
  violations.push("Unsupported Arabic OCR corpus schema.");
}
if (
  manifest.corpusId !== sources.corpusId ||
  manifest.language !== "ara" ||
  manifest.generatedFromPinnedSources !== true
) {
  violations.push("Corpus identity or language metadata is invalid.");
}
if (
  JSON.stringify(manifest.evaluationPolicy) !==
  JSON.stringify(sources.evaluationPolicy)
) {
  violations.push("OCR evaluation policies differ between source and manifest.");
}
const evaluationPolicy = manifest.evaluationPolicy;
if (
  !Number.isInteger(evaluationPolicy?.holdoutGeneration) ||
  evaluationPolicy.holdoutGeneration < 2 ||
  !Array.isArray(evaluationPolicy.holdoutSourceIds) ||
  evaluationPolicy.holdoutSourceIds.length < 2 ||
  !Array.isArray(evaluationPolicy.retiredHoldoutSourceIds)
) {
  violations.push("OCR holdout generation policy is incomplete.");
}
if (
  !Array.isArray(manifest.samples) ||
  manifest.samples.length < 30 ||
  manifest.samples.length !== sources.samples.length
) {
  violations.push(
    "The Arabic OCR corpus must contain at least 30 pinned samples.",
  );
}
if (
  manifest.referenceText?.licenseUrl !==
    "https://creativecommons.org/licenses/by-sa/4.0/deed.ar" ||
  manifest.referenceText?.qualityLevel !== 3
) {
  violations.push("Reference-text license or proofread level is invalid.");
}
if (
  manifest.acceptance?.maxAggregateArabicCharacterErrorRate > 0.25 ||
  manifest.acceptance?.maxHoldoutArabicCharacterErrorRate > 0.25 ||
  manifest.acceptance?.maxSampleArabicCharacterErrorRate > 0.5 ||
  manifest.acceptance?.minimumRecognizedArabicCharactersPerSample < 80 ||
  manifest.acceptance?.minimumValidationSamples < 5 ||
  manifest.acceptance?.minimumHoldoutSamples < 10
) {
  violations.push("OCR acceptance thresholds were weakened.");
}

const sourceIds = new Set();
const allowedEvaluationSplits = new Set([
  "development",
  "validation",
  "holdout",
]);
const sourceSplits = new Map();
const splitSources = new Map(
  [...allowedEvaluationSplits].map((split) => [split, new Set()]),
);
for (const source of sources.sourceFiles ?? []) {
  sourceIds.add(source.id);
  sourceSplits.set(source.id, source.evaluationSplit);
  splitSources.get(source.evaluationSplit)?.add(source.id);
  if (
    source.scanLicense !== "Public domain" ||
    source.copyrighted !== false ||
    !/^[a-f0-9]{40}$/u.test(source.commonsSha1 ?? "") ||
    !allowedEvaluationSplits.has(source.evaluationSplit)
  ) {
    violations.push(`${source.id}: source rights metadata is invalid.`);
  }
  assertUrl(
    source.descriptionUrl,
    "commons.wikimedia.org",
    `${source.id}.descriptionUrl`,
  );
}
const actualHoldoutSourceIds = [...(splitSources.get("holdout") ?? [])].sort();
const policyHoldoutSourceIds = [
  ...(evaluationPolicy?.holdoutSourceIds ?? []),
].sort();
if (
  JSON.stringify(actualHoldoutSourceIds) !==
  JSON.stringify(policyHoldoutSourceIds)
) {
  violations.push("Holdout sources do not match the active evaluation policy.");
}
if (
  (evaluationPolicy?.retiredHoldoutSourceIds ?? []).some(
    (sourceId) => sourceSplits.get(sourceId) === "holdout",
  )
) {
  violations.push("A retired OCR holdout source remains in the holdout split.");
}
if (evaluationPolicy?.openedAt === null) {
  if (
    evaluationPolicy.implementationSha256 !== null ||
    evaluationPolicy.holdoutContentSha256 !== null ||
    evaluationPolicy.implementationFiles !== undefined
  ) {
    violations.push("Sealed OCR holdout contains implementation metadata.");
  }
} else {
  try {
    assertOpenedHoldoutPolicy(
      evaluationPolicy,
      await computeOcrImplementationDigest(repositoryRoot),
      computeOcrHoldoutContentDigest(manifest),
    );
  } catch (error) {
    violations.push(message(error));
  }
  if (
    JSON.stringify(evaluationPolicy?.implementationFiles) !==
    JSON.stringify(OCR_IMPLEMENTATION_FILES)
  ) {
    violations.push("Opened OCR holdout implementation files are invalid.");
  }
}
if (sourceIds.size < 3) {
  violations.push("The corpus must cover at least three source books.");
}

const sampleIds = new Set();
const representedSources = new Set();
const representedDimensions = new Set();
const splitSampleCounts = new Map(
  [...allowedEvaluationSplits].map((split) => [split, 0]),
);
let validatedSamples = 0;
for (const sample of manifest.samples ?? []) {
  if (sampleIds.has(sample.id)) {
    violations.push(`Duplicate OCR sample id: ${sample.id}.`);
  }
  sampleIds.add(sample.id);
  representedSources.add(sample.sourceFile?.id);
  const evaluationSplit = sample.sourceFile?.evaluationSplit;
  if (allowedEvaluationSplits.has(evaluationSplit)) {
    splitSampleCounts.set(
      evaluationSplit,
      (splitSampleCounts.get(evaluationSplit) ?? 0) + 1,
    );
  }
  for (const dimension of sample.dimensions ?? []) {
    representedDimensions.add(dimension);
  }

  const configured = sources.samples.find((entry) => entry.id === sample.id);
  if (!configured) {
    violations.push(`${sample.id}: sample is absent from sources.json.`);
    continue;
  }
  for (const field of [
    "sourceFileId",
    "pageTitle",
    "pageId",
    "revisionId",
    "revisionTimestamp",
    "imageFile",
    "referenceFile",
    "referenceQualityLevel",
    "referenceQualityLabel",
  ]) {
    if (sample[field] !== configured[field]) {
      violations.push(`${sample.id}.${field} differs from its source pin.`);
    }
  }
  const expectedQualityLevel =
    configured.referenceQualityLevel ?? sources.referenceText.qualityLevel;
  const expectedQualityLabel =
    configured.referenceQualityLabel ?? sources.referenceText.qualityLabel;
  if (expectedQualityLevel === 4) validatedSamples += 1;
  if (
    !Array.isArray(sample.dimensions) ||
    sample.dimensions.length < 3 ||
    expectedQualityLabels.get(expectedQualityLevel) !== expectedQualityLabel ||
    sample.reference?.qualityLevel !== expectedQualityLevel ||
    sample.reference?.qualityLabel !== expectedQualityLabel
  ) {
    violations.push(`${sample.id}: coverage or proofread metadata is invalid.`);
  }
  if (
    sample.sourceFile?.scanLicense !== "Public domain" ||
    sample.sourceFile?.copyrighted !== false ||
    !sourceIds.has(sample.sourceFile?.id) ||
    evaluationSplit !== sourceSplits.get(sample.sourceFile?.id)
  ) {
    violations.push(`${sample.id}: scan rights metadata is invalid.`);
  }
  assertUrl(sample.sourcePageUrl, "ar.wikisource.org", `${sample.id}.page`);
  assertUrl(sample.image?.url, "upload.wikimedia.org", `${sample.id}.image`);
  if (!sample.sourcePageUrl?.includes(`oldid=${sample.revisionId}`)) {
    violations.push(`${sample.id}: source page does not pin its revision.`);
  }

  try {
    const image = await readFile(join(corpusDirectory, sample.imageFile));
    const imageHash = digest(image);
    const metadata = await sharp(image).metadata();
    if (imageHash !== sample.image?.sha256) {
      violations.push(`${sample.id}: image digest mismatch.`);
    }
    if (
      metadata.format !== "jpeg" ||
      metadata.width !== sample.image?.width ||
      metadata.height !== sample.image?.height ||
      image.length !== sample.image?.bytes
    ) {
      violations.push(`${sample.id}: image metadata mismatch.`);
    }
  } catch (error) {
    violations.push(`${sample.id}: image cannot be verified (${message(error)}).`);
  }

  try {
    const reference = await readFile(
      join(corpusDirectory, sample.referenceFile),
    );
    const referenceText = reference.toString("utf8").trim();
    const normalizedCharacters = Array.from(
      normalizeArabic(referenceText).replace(/\s/gu, ""),
    ).length;
    if (digest(reference) !== sample.reference?.sha256) {
      violations.push(`${sample.id}: reference digest mismatch.`);
    }
    if (
      normalizedCharacters !== sample.reference?.normalizedArabicCharacters ||
      normalizedCharacters <
        manifest.acceptance.minimumRecognizedArabicCharactersPerSample
    ) {
      violations.push(`${sample.id}: reference character count mismatch.`);
    }
  } catch (error) {
    violations.push(
      `${sample.id}: reference cannot be verified (${message(error)}).`,
    );
  }
}

if (
  representedSources.size < 10 ||
  representedDimensions.size < 20 ||
  validatedSamples < 30
) {
  violations.push("Corpus source or degradation diversity is insufficient.");
}
if (
  (splitSampleCounts.get("validation") ?? 0) <
    manifest.acceptance.minimumValidationSamples ||
  (splitSampleCounts.get("holdout") ?? 0) <
    manifest.acceptance.minimumHoldoutSamples ||
  [...allowedEvaluationSplits].some(
    (split) => (splitSources.get(split)?.size ?? 0) < 2,
  )
) {
  violations.push(
    "Source-isolated development, validation, and holdout coverage is insufficient.",
  );
}

if (violations.length > 0) {
  for (const violation of violations) process.stderr.write(`- ${violation}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Arabic OCR corpus verified (${manifest.samples.length} samples, ${representedSources.size} public-domain books, ${representedDimensions.size} documented dimensions).\n`,
  );
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertUrl(value, expectedHost, label) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== expectedHost) {
      violations.push(`${label}: URL must use HTTPS on ${expectedHost}.`);
    }
  } catch {
    violations.push(`${label}: URL is invalid.`);
  }
}

function message(error) {
  return error instanceof Error ? error.message : "unknown error";
}
