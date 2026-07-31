import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import Tesseract from "tesseract.js";
import {
  measureCharacterError,
  normalizeArabic,
  round,
} from "./ocr-benchmark-utils.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const corpusDirectory = join(
  repositoryRoot,
  "artifacts",
  "benchmarks",
  "ocr-arabic-corpus",
);
const manifest = JSON.parse(
  await readFile(join(corpusDirectory, "manifest.json"), "utf8"),
);
const developmentSamples = manifest.samples.filter(
  (sample) => sample.sourceFile.evaluationSplit !== "holdout",
);
const requestedSampleIds = new Set(
  process.argv
    .filter((argument) => argument.startsWith("--sample="))
    .map((argument) => argument.slice("--sample=".length))
    .filter(Boolean),
);
const selectedSamples =
  requestedSampleIds.size === 0
    ? developmentSamples
    : developmentSamples.filter((sample) => requestedSampleIds.has(sample.id));
if (requestedSampleIds.size > 0 && selectedSamples.length !== requestedSampleIds.size) {
  throw new Error("One or more requested development sample identifiers were not found.");
}
const require = createRequire(import.meta.url);
const language = require("@tesseract.js-data/ara");
const fallbackConfidence = 0.5;
const fallbackMinimumWords = 20;
const configurations = [
  {
    id: "auto-normalize",
    mode: Tesseract.PSM.AUTO,
    preprocessing: "normalize",
  },
  {
    id: "column-normalize",
    mode: Tesseract.PSM.SINGLE_COLUMN,
    preprocessing: "normalize",
  },
  {
    id: "block-normalize",
    mode: Tesseract.PSM.SINGLE_BLOCK,
    preprocessing: "normalize",
  },
  {
    id: "sparse-normalize",
    mode: Tesseract.PSM.SPARSE_TEXT,
    preprocessing: "normalize",
  },
  {
    id: "column-threshold-190",
    mode: Tesseract.PSM.SINGLE_COLUMN,
    preprocessing: "threshold-190",
  },
  {
    id: "sparse-threshold-190",
    mode: Tesseract.PSM.SPARSE_TEXT,
    preprocessing: "threshold-190",
  },
  {
    id: "sparse-sharpen",
    mode: Tesseract.PSM.SPARSE_TEXT,
    preprocessing: "sharpen",
  },
  {
    id: "sparse-median",
    mode: Tesseract.PSM.SPARSE_TEXT,
    preprocessing: "median",
  },
  {
    id: "auto-sharpen",
    mode: Tesseract.PSM.AUTO,
    preprocessing: "sharpen",
  },
  {
    id: "auto-trim-sharpen",
    mode: Tesseract.PSM.AUTO,
    preprocessing: "trim-sharpen",
  },
];
const worker = await Tesseract.createWorker(
  language.code,
  Tesseract.OEM.LSTM_ONLY,
  {
    langPath: language.langPath,
    gzip: language.gzip,
    cacheMethod: "none",
  },
);
await worker.setParameters({
  preserve_interword_spaces: "1",
  user_defined_dpi: "144",
});

const startedAt = performance.now();
const samples = [];
try {
  for (const sample of selectedSamples) {
    const source = await readFile(join(corpusDirectory, sample.imageFile));
    const rendered = await sharp(source)
      .resize({
        width: 1_600,
        height: 1_600,
        fit: "inside",
        withoutEnlargement: false,
        kernel: sharp.kernel.lanczos3,
      })
      .png()
      .toBuffer();
    const reference = await readFile(
      join(corpusDirectory, sample.referenceFile),
      "utf8",
    );
    const preparedImages = new Map();
    const candidates = [];
    for (const configuration of configurations) {
      if (
        configuration.id !== "auto-normalize" &&
        !shouldRunFallback(candidates[0])
      ) {
        break;
      }
      let image = preparedImages.get(configuration.preprocessing);
      if (!image) {
        image = await prepareImage(rendered, configuration.preprocessing);
        preparedImages.set(configuration.preprocessing, image);
      }
      await worker.setParameters({
        tessedit_pageseg_mode: configuration.mode,
      });
      const candidateStartedAt = performance.now();
      const result = await worker.recognize(
        image.data,
        {},
        { text: true, blocks: true },
      );
      candidates.push(
        measureCandidate({
          configuration,
          blocks: result.data.blocks ?? [],
          reference,
          width: image.info.width,
          height: image.info.height,
          durationMilliseconds: Math.round(
            performance.now() - candidateStartedAt,
          ),
        }),
      );
    }
    samples.push({
      id: sample.id,
      evaluationSplit: sample.sourceFile.evaluationSplit,
      sourceFileId: sample.sourceFile.id,
      candidates,
    });
    process.stderr.write(
      `${sample.id}: ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}\n`,
    );
  }
} finally {
  await worker.terminate();
}

const report = {
  schemaVersion: 1,
  corpusId: manifest.corpusId,
  scope:
    requestedSampleIds.size === 0
      ? "development-without-holdout"
      : "targeted-development-without-holdout",
  generatedAt: new Date().toISOString(),
  trigger: {
    minimumWords: fallbackMinimumWords,
    minimumAverageConfidence: fallbackConfidence,
  },
  configurations: configurations.map(({ id, preprocessing }) => ({
    id,
    preprocessing,
  })),
  samples,
  durationMilliseconds: Math.round(performance.now() - startedAt),
};
const outputFile =
  requestedSampleIds.size === 0
    ? "selector-evaluation.json"
    : "selector-evaluation-targeted.json";
await writeFile(
  join(corpusDirectory, outputFile),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `Measured ${samples.reduce((sum, sample) => sum + sample.candidates.length, 0)} OCR candidates across ${samples.length} samples.\n`,
);

async function prepareImage(source, preprocessing) {
  if (preprocessing === "trim-sharpen") {
    return sharp(source)
      .trim({ background: "#ffffff", threshold: 5 })
      .extend({
        top: 36,
        bottom: 36,
        left: 36,
        right: 36,
        background: "#ffffff",
      })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1 })
      .png()
      .toBuffer({ resolveWithObject: true });
  }

  let pipeline = sharp(source).grayscale();
  switch (preprocessing) {
    case "normalize":
      pipeline = pipeline.normalize();
      break;
    case "threshold-190":
      pipeline = pipeline.threshold(190);
      break;
    case "sharpen":
      pipeline = pipeline.normalize().sharpen({ sigma: 1 });
      break;
    case "median":
      pipeline = pipeline.normalize().median(3);
      break;
    default:
      throw new Error(`Unknown preprocessing: ${preprocessing}`);
  }
  return pipeline.png().toBuffer({ resolveWithObject: true });
}

function shouldRunFallback(primary) {
  return (
    !primary ||
    primary.wordCount < fallbackMinimumWords ||
    primary.averageConfidence < fallbackConfidence
  );
}

function measureCandidate({
  configuration,
  blocks,
  reference,
  width,
  height,
  durationMilliseconds,
}) {
  const lines = blocks.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines),
  );
  const words = lines.flatMap((line) => line.words);
  const text = words
    .map((word) => word.text.trim())
    .filter(Boolean)
    .join(" ");
  const measurement = measureCharacterError(reference, text);
  const confidences = words
    .map((word) => word.confidence / 100)
    .sort((left, right) => left - right);
  const normalized = normalizeArabic(text);
  const allCharacters = Array.from(text.replace(/\s/gu, ""));
  const arabicCharacters = Array.from(
    normalized.replace(/[^\p{Script=Arabic}]/gu, ""),
  ).length;
  const latinCharacters = Array.from(
    text.match(/\p{Script=Latin}/gu) ?? [],
  ).length;
  const digitCharacters = Array.from(text.match(/\p{Number}/gu) ?? []).length;
  const wordBounds = words.map((word) => word.bbox);
  const contentBounds =
    wordBounds.length > 0
      ? {
          left: Math.min(...wordBounds.map((bounds) => bounds.x0)),
          top: Math.min(...wordBounds.map((bounds) => bounds.y0)),
          right: Math.max(...wordBounds.map((bounds) => bounds.x1)),
          bottom: Math.max(...wordBounds.map((bounds) => bounds.y1)),
        }
      : null;
  return {
    configurationId: configuration.id,
    wordCount: words.length,
    lineCount: lines.length,
    blockCount: blocks.length,
    averageConfidence: round(
      confidences.reduce((sum, confidence) => sum + confidence, 0) /
        Math.max(1, confidences.length),
    ),
    medianConfidence: round(
      confidences[Math.floor(confidences.length / 2)] ?? 0,
    ),
    lowConfidenceWordRatio: round(
      words.filter((word) => word.confidence < 20).length /
        Math.max(1, words.length),
    ),
    arabicCharacterRatio: round(
      arabicCharacters / Math.max(1, allCharacters.length),
    ),
    latinCharacterRatio: round(
      latinCharacters / Math.max(1, allCharacters.length),
    ),
    digitCharacterRatio: round(
      digitCharacters / Math.max(1, allCharacters.length),
    ),
    contentCoverage: contentBounds
      ? round(
          ((contentBounds.right - contentBounds.left) *
            (contentBounds.bottom - contentBounds.top)) /
            Math.max(1, width * height),
        )
      : 0,
    recognizedCharacterCount: measurement.recognizedCharacterCount,
    normalizedRecognized: measurement.normalizedRecognized,
    characterErrors: measurement.characterErrors,
    expectedCharacterCount: measurement.expectedCharacterCount,
    characterErrorRate: round(measurement.characterErrorRate),
    durationMilliseconds,
  };
}
