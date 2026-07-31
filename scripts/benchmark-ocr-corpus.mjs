import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalArabicPdfOcrEngine } from "@motionprep/document-processing";
import sharp from "sharp";
import {
  measureCharacterError,
  round,
} from "./ocr-benchmark-utils.mjs";
import {
  assertOpenedHoldoutPolicy,
  computeOcrImplementationDigest,
  computeOcrHoldoutContentDigest,
} from "./ocr-holdout-policy.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const excludeHoldout = process.argv.includes("--exclude-holdout");
const writeReport = process.argv.includes("--write-report");
const summaryOnly = process.argv.includes("--summary");
if (excludeHoldout && writeReport) {
  throw new Error(
    "A development-only OCR run cannot overwrite the official corpus report.",
  );
}
const corpusDirectory = join(
  repositoryRoot,
  "artifacts",
  "benchmarks",
  "ocr-arabic-corpus",
);
const manifest = JSON.parse(
  await readFile(join(corpusDirectory, "manifest.json"), "utf8"),
);
if (!excludeHoldout) {
  assertOpenedHoldoutPolicy(
    manifest.evaluationPolicy,
    await computeOcrImplementationDigest(repositoryRoot),
    computeOcrHoldoutContentDigest(manifest),
  );
}
const benchmarkSamples = excludeHoldout
  ? manifest.samples.filter(
      (sample) => sample.sourceFile.evaluationSplit !== "holdout",
    )
  : manifest.samples;
const startedAt = performance.now();
const fallbacks = new Map();
const engine = new LocalArabicPdfOcrEngine({
  onFallback: (event) => fallbacks.set(event.pageNumber, event),
});
const samples = [];

try {
  for (const [index, sample] of benchmarkSamples.entries()) {
    const image = await readFile(join(corpusDirectory, sample.imageFile));
    const prepared = await sharp(image)
      .resize({
        width: 1_600,
        height: 1_600,
        fit: "inside",
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer({ resolveWithObject: true });
    const referenceText = await readFile(
      join(corpusDirectory, sample.referenceFile),
      "utf8",
    );
    const sampleStartedAt = performance.now();
    const scale = Math.min(
      prepared.info.width / sample.image.width,
      prepared.info.height / sample.image.height,
    );
    const items = await engine.recognizePage({
      pageNumber: index + 1,
      image: prepared.data,
      width: sample.image.width,
      height: sample.image.height,
      renderScale: scale,
    });
    const recognizedText = items.map((item) => item.text).join(" ");
    const measurement = measureCharacterError(referenceText, recognizedText);
    const averageConfidence =
      items.reduce((sum, item) => sum + item.confidence, 0) /
      Math.max(1, items.length);
    const failures = [];
    if (
      measurement.recognizedNonWhitespaceCharacterCount <
      manifest.acceptance.minimumRecognizedArabicCharactersPerSample
    ) {
      failures.push("recognized Arabic text is below the minimum length");
    }
    if (
      measurement.characterErrorRate >
      manifest.acceptance.maxSampleArabicCharacterErrorRate
    ) {
      failures.push("page CER exceeds the release target");
    }
    samples.push({
      id: sample.id,
      passed: failures.length === 0,
      evaluationSplit: sample.sourceFile.evaluationSplit,
      fallback: fallbacks.get(index + 1) ?? null,
      dimensions: sample.dimensions,
      sourcePageUrl: sample.sourcePageUrl,
      referenceRevisionId: sample.revisionId,
      sourceImage: {
        width: sample.image.width,
        height: sample.image.height,
        sha256: sample.image.sha256,
      },
      preparedImage: {
        width: prepared.info.width,
        height: prepared.info.height,
        renderScale: round(scale),
      },
      wordCount: items.length,
      averageConfidence: round(averageConfidence),
      expectedCharacterCount: measurement.expectedCharacterCount,
      recognizedCharacterCount: measurement.recognizedCharacterCount,
      recognizedNonWhitespaceCharacterCount:
        measurement.recognizedNonWhitespaceCharacterCount,
      characterErrors: measurement.characterErrors,
      characterErrorRate: round(measurement.characterErrorRate),
      recognizedText,
      normalizedRecognized: measurement.normalizedRecognized,
      failures,
      durationMilliseconds: Math.round(
        performance.now() - sampleStartedAt,
      ),
    });
  }
} finally {
  await engine.close();
}

const totals = samples.reduce(
  (result, sample) => ({
    expectedCharacters:
      result.expectedCharacters + sample.expectedCharacterCount,
    recognizedCharacters:
      result.recognizedCharacters + sample.recognizedCharacterCount,
    characterErrors: result.characterErrors + sample.characterErrors,
    words: result.words + sample.wordCount,
  }),
  {
    expectedCharacters: 0,
    recognizedCharacters: 0,
    characterErrors: 0,
    words: 0,
  },
);
const aggregateCharacterErrorRate =
  totals.characterErrors / Math.max(1, totals.expectedCharacters);
const aggregateBySplit = Object.fromEntries(
  ["development", "validation", "holdout"].map((evaluationSplit) => {
    const splitSamples = samples.filter(
      (sample) => sample.evaluationSplit === evaluationSplit,
    );
    const splitTotals = splitSamples.reduce(
      (result, sample) => ({
        expectedCharacters:
          result.expectedCharacters + sample.expectedCharacterCount,
        recognizedCharacters:
          result.recognizedCharacters + sample.recognizedCharacterCount,
        characterErrors: result.characterErrors + sample.characterErrors,
        words: result.words + sample.wordCount,
      }),
      {
        expectedCharacters: 0,
        recognizedCharacters: 0,
        characterErrors: 0,
        words: 0,
      },
    );
    return [
      evaluationSplit,
      {
        sampleCount: splitSamples.length,
        wordCount: splitTotals.words,
        expectedCharacterCount: splitTotals.expectedCharacters,
        recognizedCharacterCount: splitTotals.recognizedCharacters,
        characterErrors: splitTotals.characterErrors,
        characterErrorRate: round(
          splitTotals.characterErrors /
            Math.max(1, splitTotals.expectedCharacters),
        ),
      },
    ];
  }),
);
const failures = samples
  .filter((sample) => !sample.passed)
  .map((sample) => `${sample.id}: ${sample.failures.join(", ")}`);
if (
  aggregateCharacterErrorRate >
  manifest.acceptance.maxAggregateArabicCharacterErrorRate
) {
  failures.push("aggregate CER exceeds the release target");
}
if (
  !excludeHoldout &&
  aggregateBySplit.holdout.characterErrorRate >
  manifest.acceptance.maxHoldoutArabicCharacterErrorRate
) {
  failures.push("holdout CER exceeds the release target");
}

const report = {
  schemaVersion: 1,
  benchmark: manifest.corpusId,
  scope: excludeHoldout ? "development-without-holdout" : "official-full-corpus",
  holdoutGeneration: manifest.evaluationPolicy?.holdoutGeneration ?? null,
  implementationSha256:
    manifest.evaluationPolicy?.implementationSha256 ?? null,
  holdoutContentSha256:
    manifest.evaluationPolicy?.holdoutContentSha256 ?? null,
  language: manifest.language,
  passed: failures.length === 0,
  generatedAt: new Date().toISOString(),
  comparison: {
    script: "Arabic",
    normalizer: "arabic-cer-v1",
    note: "Latin text on mixed-script pages is outside the Arabic-only CER.",
  },
  acceptance: manifest.acceptance,
  aggregate: {
    sampleCount: samples.length,
    wordCount: totals.words,
    expectedCharacterCount: totals.expectedCharacters,
    recognizedCharacterCount: totals.recognizedCharacters,
    characterErrors: totals.characterErrors,
    characterErrorRate: round(aggregateCharacterErrorRate),
  },
  aggregateBySplit,
  samples,
  failures,
  durationMilliseconds: Math.round(performance.now() - startedAt),
};

if (writeReport) {
  await writeFile(
    join(corpusDirectory, "latest-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}
const output = summaryOnly
  ? {
      schemaVersion: report.schemaVersion,
      benchmark: report.benchmark,
      scope: report.scope,
      passed: report.passed,
      generatedAt: report.generatedAt,
      aggregate: report.aggregate,
      aggregateBySplit: report.aggregateBySplit,
      failures: report.failures,
      durationMilliseconds: report.durationMilliseconds,
    }
  : report;
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
if (!report.passed) process.exitCode = 1;
