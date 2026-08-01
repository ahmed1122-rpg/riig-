import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { normalizeArabic } from "./ocr-benchmark-utils.mjs";
import { cleanProofreadWikitext } from "./ocr-corpus-wikitext.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const directory = join(
  repositoryRoot,
  "artifacts",
  "benchmarks",
  "ocr-arabic-corpus",
);
const sourcePath = join(directory, "sources.json");
const manifestPath = join(directory, "manifest.json");
const sources = JSON.parse(await readFile(sourcePath, "utf8"));
const refresh = process.argv.includes("--refresh");
const userAgent =
  "MotionPrep OCR readiness corpus/1.0 (offline benchmark materializer)";
const qualityMetadata = new Map([
  [
    3,
    {
      label: "community-proofread",
      category: "تصنيف:صححت",
    },
  ],
  [
    4,
    {
      label: "community-validated",
      category: "تصنيف:تم التحقق منها",
    },
  ],
]);

const existingManifest = await readOptionalJson(manifestPath);
const rights = await query("ar.wikisource.org", {
  meta: "siteinfo",
  siprop: "rightsinfo",
});
assert(
  rights.query?.rightsinfo?.url === sources.referenceText.licenseUrl,
  "Arabic Wikisource transcription license changed.",
);

const sourceFiles = new Map();
const commonsResponse = await query("commons.wikimedia.org", {
  prop: "imageinfo",
  titles: sources.sourceFiles.map((source) => source.fileTitle).join("|"),
  iiprop: "url|sha1|mime|size|extmetadata",
});
const commonsPages = new Map(
  (commonsResponse.query?.pages ?? []).map((page) => [page.title, page]),
);
for (const source of sources.sourceFiles) {
  const page = commonsPages.get(source.fileTitle);
  const imageInfo = page?.imageinfo?.[0];
  const metadata = imageInfo?.extmetadata ?? {};
  assert(page?.pageid === source.commonsPageId, `${source.id}: page id changed.`);
  assert(
    imageInfo?.sha1 === source.commonsSha1,
    `${source.id}: Commons source digest changed.`,
  );
  assert(
    metadata.LicenseShortName?.value === "Public domain" &&
      metadata.Copyrighted?.value === "False",
    `${source.id}: scan is no longer reported as public domain.`,
  );
  assert(
    imageInfo?.mime === "application/pdf",
    `${source.id}: source is no longer a PDF.`,
  );
  sourceFiles.set(source.id, {
    ...source,
    sourcePdfUrl: imageInfo.url,
    sourcePdfBytes: imageInfo.size,
  });
}

const revisionPages = new Map();
for (const samples of chunks(sources.samples, 20)) {
  const response = await query("ar.wikisource.org", {
    prop: "revisions|categories|imageforpage",
    revids: samples.map((sample) => sample.revisionId).join("|"),
    rvprop: "ids|timestamp|content",
    rvslots: "main",
    cllimit: "max",
  });
  for (const page of response.query?.pages ?? []) {
    const revisionId = page.revisions?.[0]?.revid;
    if (Number.isInteger(revisionId)) revisionPages.set(revisionId, page);
  }
}

const materialized = [];
for (const sample of sources.samples) {
  const referenceQualityLevel =
    sample.referenceQualityLevel ?? sources.referenceText.qualityLevel;
  const referenceQualityLabel =
    sample.referenceQualityLabel ?? sources.referenceText.qualityLabel;
  const expectedQuality = qualityMetadata.get(referenceQualityLevel);
  assert(
    expectedQuality?.label === referenceQualityLabel,
    `${sample.id}: unsupported reference quality metadata.`,
  );
  const page = revisionPages.get(sample.revisionId);
  const revision = page?.revisions?.[0];
  const wikitext = revision?.slots?.main?.content;
  const categories = page?.categories?.map((entry) => entry.title) ?? [];
  const sourceFile = sourceFiles.get(sample.sourceFileId);

  assert(sourceFile, `${sample.id}: unknown source file.`);
  assert(page?.pageid === sample.pageId, `${sample.id}: page id changed.`);
  assert(page?.title === sample.pageTitle, `${sample.id}: page title changed.`);
  assert(
    revision?.revid === sample.revisionId,
    `${sample.id}: pinned revision was not returned.`,
  );
  assert(
    revision?.timestamp === sample.revisionTimestamp,
    `${sample.id}: revision timestamp changed.`,
  );
  assert(
    typeof wikitext === "string" &&
      Number(
        wikitext.match(/<pagequality\s+level="(\d)"(?:\s|\/?>)/u)?.[1],
      ) === referenceQualityLevel,
    `${sample.id}: revision is not level-${referenceQualityLevel} ${referenceQualityLabel} text.`,
  );
  assert(
    categories.includes(expectedQuality.category),
    `${sample.id}: current page is not categorized as ${referenceQualityLabel}.`,
  );

  const imageUrl = canonicalImageUrl({
    value: page.imagesforpage?.fullsize,
    sampleId: sample.id,
    pageTitle: sample.pageTitle,
    sourcePdfUrl: sourceFile.sourcePdfUrl,
  });
  const imagePath = join(directory, sample.imageFile);
  const existingSample = existingManifest?.samples?.find(
    (entry) =>
      entry.id === sample.id &&
      entry.revisionId === sample.revisionId &&
      entry.image?.url === imageUrl,
  );
  let image;
  let imageWasDownloaded = false;
  if (existingSample?.image?.sha256) {
    try {
      const cachedImage = await readFile(imagePath);
      if (digest(cachedImage) === existingSample.image.sha256) {
        image = cachedImage;
      }
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  if (!image) {
    const imageResponse = await fetchWithRetry(imageUrl);
    assert(
      imageResponse.ok,
      `${sample.id}: image download failed with ${imageResponse.status}.`,
    );
    image = Buffer.from(await imageResponse.arrayBuffer());
    imageWasDownloaded = true;
  }
  const imageMetadata = await sharp(image).metadata();
  assert(
    imageMetadata.format === "jpeg" &&
      Number.isInteger(imageMetadata.width) &&
      Number.isInteger(imageMetadata.height),
    `${sample.id}: expected a dimensioned JPEG page image.`,
  );

  const referenceText = cleanProofreadWikitext(wikitext);
  const normalizedArabicCharacters = Array.from(
    normalizeArabic(referenceText).replace(/\s/gu, ""),
  ).length;
  assert(
    normalizedArabicCharacters >=
      sources.acceptance.minimumRecognizedArabicCharactersPerSample,
    `${sample.id}: reference text is unexpectedly short.`,
  );

  const referencePath = join(directory, sample.referenceFile);
  await mkdir(dirname(imagePath), { recursive: true });
  await mkdir(dirname(referencePath), { recursive: true });
  if (imageWasDownloaded) await writeFile(imagePath, image);
  await writeFile(referencePath, `${referenceText}\n`, "utf8");

  materialized.push({
    ...sample,
    sourcePageUrl: `https://ar.wikisource.org/w/index.php?title=${encodeURIComponent(sample.pageTitle)}&oldid=${sample.revisionId}`,
    image: {
      url: imageUrl,
      mediaType: "image/jpeg",
      width: imageMetadata.width,
      height: imageMetadata.height,
      bytes: image.length,
      sha256: digest(image),
    },
    reference: {
      license: sources.referenceText.license,
      licenseUrl: sources.referenceText.licenseUrl,
      qualityLevel: referenceQualityLevel,
      qualityLabel: referenceQualityLabel,
      normalizer: "arabic-cer-v1",
      characters: Array.from(referenceText).length,
      normalizedArabicCharacters,
      sha256: digest(Buffer.from(`${referenceText}\n`, "utf8")),
    },
    sourceFile: {
      id: sourceFile.id,
      fileTitle: sourceFile.fileTitle,
      creator: sourceFile.creator,
      evaluationSplit: sourceFile.evaluationSplit,
      descriptionUrl: sourceFile.descriptionUrl,
      scanLicense: sourceFile.scanLicense,
      copyrighted: sourceFile.copyrighted,
      commonsPageId: sourceFile.commonsPageId,
      commonsSha1: sourceFile.commonsSha1,
      sourcePdfUrl: sourceFile.sourcePdfUrl,
      sourcePdfBytes: sourceFile.sourcePdfBytes,
    },
  });
}

const manifest = {
  schemaVersion: 1,
  corpusId: sources.corpusId,
  language: sources.language,
  generatedFromPinnedSources: true,
  evaluationPolicy: sources.evaluationPolicy,
  referenceText: sources.referenceText,
  acceptance: sources.acceptance,
  samples: materialized,
};

if (existingManifest && !refresh) {
  assert(
    stableJson(existingManifest) === stableJson(manifest),
    "Materialized corpus differs from the pinned manifest; inspect upstream changes and use --refresh only after review.",
  );
} else {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

process.stdout.write(
  `Materialized ${materialized.length} pinned public-domain Arabic OCR samples${refresh ? " and refreshed manifest" : ""}.\n`,
);

async function query(host, parameters) {
  const url = new URL(`https://${host}/w/api.php`);
  for (const [key, value] of Object.entries({
    action: "query",
    format: "json",
    formatversion: "2",
    ...parameters,
  })) {
    url.searchParams.set(key, value);
  }
  const response = await fetchWithRetry(url);
  assert(response.ok, `${host}: API request failed with ${response.status}.`);
  const result = await response.json();
  assert(!result.error, `${host}: ${result.error?.info ?? "API error"}.`);
  return result;
}

async function fetchWithRetry(url) {
  let response;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    response = await fetch(url, {
      headers: { "user-agent": userAgent },
    });
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt === 4) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delayMilliseconds = Number.isFinite(retryAfter)
      ? Math.min(30_000, Math.max(1_000, retryAfter * 1_000))
      : 1_000 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delayMilliseconds));
  }
  return response;
}

function canonicalImageUrl({ value, sampleId, pageTitle, sourcePdfUrl }) {
  const url =
    typeof value === "string" && value.length > 0
      ? new URL(value.startsWith("//") ? `https:${value}` : value)
      : pdfThumbnailUrl({ sampleId, pageTitle, sourcePdfUrl });
  url.search = "";
  return url.href;
}

function pdfThumbnailUrl({ sampleId, pageTitle, sourcePdfUrl }) {
  const pageNumber = Number(pageTitle.match(/\/(\d+)$/u)?.[1]);
  const url = new URL(sourcePdfUrl);
  const filename = url.pathname.split("/").at(-1);
  assert(
    Number.isInteger(pageNumber) &&
      pageNumber > 0 &&
      filename &&
      url.hostname === "upload.wikimedia.org" &&
      url.pathname.startsWith("/wikipedia/commons/"),
    `${sampleId}: cannot derive the missing page image URL.`,
  );
  const sourceDirectory = url.pathname.slice(
    0,
    -(filename.length + 1),
  );
  url.pathname = `${sourceDirectory.replace(
    "/wikipedia/commons",
    "/wikipedia/commons/thumb",
  )}/${filename}/page${pageNumber}-960px-${filename}.jpg`;
  return url;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readOptionalJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function stableJson(value) {
  return JSON.stringify(value);
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
