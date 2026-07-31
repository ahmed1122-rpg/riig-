import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
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
const sourcesPath = join(corpusDirectory, "sources.json");
const manifestPath = join(corpusDirectory, "manifest.json");
const sources = JSON.parse(await readFile(sourcesPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (
  JSON.stringify(sources.evaluationPolicy) !==
  JSON.stringify(manifest.evaluationPolicy)
) {
  throw new Error(
    "Materialize and verify the sealed OCR corpus before opening its holdout.",
  );
}
if (
  sources.evaluationPolicy?.openedAt !== null ||
  sources.evaluationPolicy?.implementationSha256 !== null ||
  sources.evaluationPolicy?.holdoutContentSha256 !== null
) {
  throw new Error("OCR holdout generation is already open.");
}

const holdoutSourceIds = new Set(
  sources.sourceFiles
    .filter((source) => source.evaluationSplit === "holdout")
    .map((source) => source.id),
);
if (
  JSON.stringify([...holdoutSourceIds].sort()) !==
  JSON.stringify([...sources.evaluationPolicy.holdoutSourceIds].sort())
) {
  throw new Error("Configured OCR holdout sources do not match the policy.");
}

const openedPolicy = {
  ...sources.evaluationPolicy,
  implementationFiles: OCR_IMPLEMENTATION_FILES,
  openedAt: new Date().toISOString(),
  implementationSha256:
    await computeOcrImplementationDigest(repositoryRoot),
  holdoutContentSha256: computeOcrHoldoutContentDigest(manifest),
};
sources.evaluationPolicy = openedPolicy;
manifest.evaluationPolicy = openedPolicy;

await writeFile(sourcesPath, `${JSON.stringify(sources, null, 2)}\n`, "utf8");
await writeFile(
  manifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `Opened OCR holdout generation ${openedPolicy.holdoutGeneration} at ${openedPolicy.openedAt}.\n`,
);
