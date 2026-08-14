import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const OCR_IMPLEMENTATION_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "packages/document-processing/package.json",
  "packages/document-processing/src/index.ts",
  "packages/document-processing/src/ocr-fallback.ts",
  "packages/document-processing/src/ocr-pipeline.ts",
  "packages/document-processing/src/ocr-review.ts",
  "packages/document-processing/src/pdf-ocr.ts",
  "scripts/benchmark-ocr-corpus.mjs",
  "scripts/fetch-ocr-corpus.mjs",
  "scripts/ocr-benchmark-utils.mjs",
  "scripts/ocr-corpus-wikitext.mjs",
  "scripts/ocr-holdout-policy.mjs",
  "scripts/open-ocr-holdout.mjs",
  "scripts/verify-ocr-corpus.mjs",
]);

export async function computeOcrImplementationDigest(repositoryRoot) {
  const hash = createHash("sha256");
  for (const relativePath of OCR_IMPLEMENTATION_FILES) {
    hash.update(relativePath, "utf8");
    hash.update("\0", "utf8");
    hash.update(await readFile(join(repositoryRoot, relativePath)));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

export function computeOcrHoldoutContentDigest(manifest) {
  const holdoutSourceIds = new Set(
    manifest?.evaluationPolicy?.holdoutSourceIds ?? [],
  );
  const holdoutSamples = (manifest?.samples ?? [])
    .filter((sample) => holdoutSourceIds.has(sample.sourceFile?.id))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const payload = {
    schemaVersion: manifest?.schemaVersion,
    corpusId: manifest?.corpusId,
    language: manifest?.language,
    referenceText: manifest?.referenceText,
    acceptance: manifest?.acceptance,
    holdoutGeneration: manifest?.evaluationPolicy?.holdoutGeneration,
    holdoutSourceIds: [...holdoutSourceIds].sort(),
    samples: holdoutSamples,
  };
  return createHash("sha256")
    .update(canonicalJson(payload), "utf8")
    .digest("hex");
}

export function assertOpenedHoldoutPolicy(
  policy,
  implementationDigest,
  holdoutContentDigest,
) {
  if (
    !policy ||
    !Number.isInteger(policy.holdoutGeneration) ||
    policy.holdoutGeneration < 2 ||
    !Array.isArray(policy.holdoutSourceIds) ||
    policy.holdoutSourceIds.length < 2
  ) {
    throw new Error("OCR holdout policy is missing or incomplete.");
  }
  if (!policy.openedAt || !Number.isFinite(Date.parse(policy.openedAt))) {
    throw new Error(
      "OCR holdout is sealed. Open it once with npm run benchmark:ocr:holdout:open.",
    );
  }
  if (
    JSON.stringify(policy.implementationFiles) !==
    JSON.stringify(OCR_IMPLEMENTATION_FILES)
  ) {
    throw new Error(
      "OCR holdout implementation boundary changed; rotate the holdout before benchmarking again.",
    );
  }
  if (policy.implementationSha256 !== implementationDigest) {
    throw new Error(
      "OCR implementation changed after the holdout was opened; rotate the holdout before benchmarking again.",
    );
  }
  if (
    !/^[a-f0-9]{64}$/u.test(policy.holdoutContentSha256 ?? "") ||
    policy.holdoutContentSha256 !== holdoutContentDigest
  ) {
    throw new Error(
      "OCR holdout content changed after it was opened; rotate the holdout before benchmarking again.",
    );
  }
}

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
