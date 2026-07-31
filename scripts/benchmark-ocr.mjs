import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalArabicPdfOcrEngine } from "@motionprep/document-processing";
import {
  measureCharacterError,
  normalizeArabic,
  round,
} from "./ocr-benchmark-utils.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDirectory = join(
  repositoryRoot,
  "artifacts",
  "benchmarks",
  "ocr-arabic",
);
const expected = JSON.parse(
  await readFile(join(fixtureDirectory, "expected.json"), "utf8"),
);
const image = await readFile(join(fixtureDirectory, expected.fixture));
const expectedText = expected.sourceLines.join(" ");
const startedAt = performance.now();
const engine = new LocalArabicPdfOcrEngine();

let items;
try {
  items = await engine.recognizePage({
    pageNumber: 1,
    image,
    width: 800,
    height: 450,
    renderScale: 2,
  });
} finally {
  await engine.close();
}

const recognizedText = items.map((item) => item.text).join(" ");
const measurement = measureCharacterError(expectedText, recognizedText);
const missingTokens = expected.requiredTokens.filter(
  (token) =>
    !measurement.normalizedRecognized.includes(normalizeArabic(token)),
);
const averageConfidence =
  items.reduce((sum, item) => sum + item.confidence, 0) /
  Math.max(1, items.length);
const passed =
  items.length > 0 &&
  missingTokens.length === 0 &&
  measurement.characterErrorRate <= expected.maxCharacterErrorRate;
const report = {
  schemaVersion: 1,
  passed,
  fixture: expected.fixture,
  scope: expected.kind,
  recognizedText,
  normalizedRecognized: measurement.normalizedRecognized,
  wordCount: items.length,
  averageConfidence: round(averageConfidence),
  characterErrorRate: round(measurement.characterErrorRate),
  threshold: expected.maxCharacterErrorRate,
  missingTokens,
  durationMilliseconds: Math.round(performance.now() - startedAt),
};

console.log(JSON.stringify(report, null, 2));
if (!passed) process.exitCode = 1;
