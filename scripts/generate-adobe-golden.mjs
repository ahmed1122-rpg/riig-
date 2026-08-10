import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPdfDocumentPsd,
  createRasterPsd,
} from "@motionprep/export-adapters";
import sharp from "sharp";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = process.env.ADOBE_GOLDEN_OUTPUT_DIRECTORY
  ? resolve(process.env.ADOBE_GOLDEN_OUTPUT_DIRECTORY)
  : join(root, "artifacts", "adobe-golden", "generated");
await mkdir(outputDirectory, { recursive: true });

const imageDocument = {
  schemaVersion: "1.0",
  projectId: "golden-image",
  sourceVersionId: "golden-image-v1",
  revision: 1,
  generatedAt: "2026-07-28T00:00:00.000Z",
  width: 640,
  height: 360,
  colorSpace: "sRGB",
  layers: [
    {
      id: "golden-background",
      parentId: null,
      kind: "raster",
      name: "+الخلفية",
      visible: true,
      locked: true,
      opacity: 1,
      fixed: true,
      zIndex: 0,
      bounds: { x: 0, y: 0, width: 640, height: 360 },
    },
    {
      id: "golden-card",
      parentId: null,
      kind: "raster",
      name: "+البطاقة",
      visible: true,
      locked: false,
      opacity: 0.72,
      fixed: false,
      zIndex: 1,
      bounds: { x: 170, y: 80, width: 300, height: 200 },
    },
  ],
};
const background = await sharp({
  create: {
    width: 640,
    height: 360,
    channels: 4,
    background: { r: 25, g: 35, b: 64, alpha: 1 },
  },
})
  .png()
  .toBuffer();
const card = await sharp({
  create: {
    width: 300,
    height: 200,
    channels: 4,
    background: { r: 244, g: 177, b: 74, alpha: 0.9 },
  },
})
  .png()
  .toBuffer();
const imagePsd = await createRasterPsd(imageDocument, [
  { layer: imageDocument.layers[0], source: background },
  { layer: imageDocument.layers[1], source: card },
]);

const bookDocument = {
  schemaVersion: "1.0",
  projectId: "golden-book",
  sourceVersionId: "golden-book-v1",
  revision: 1,
  generatedAt: "2026-07-28T00:00:00.000Z",
  width: 640,
  height: 360,
  colorSpace: "sRGB",
  pages: [
    { pageNumber: 1, width: 640, height: 360 },
    { pageNumber: 2, width: 640, height: 360 },
  ],
  layers: [
    backgroundLayer(1),
    textLayer(
      "golden-arabic",
      "+عنوان_عربي",
      "كتاب 2026 Motion",
      1,
      "rtl",
      1,
    ),
    backgroundLayer(2),
    textLayer(
      "golden-english",
      "+English_title",
      "Motion Book",
      2,
      "ltr",
      1,
    ),
  ],
};
const bookPsd = await createPdfDocumentPsd(bookDocument);

const files = [
  {
    filename: "image-layers.psd",
    body: imagePsd,
    expected: {
      width: 640,
      height: 360,
      rootLayers: ["+البطاقة", "+الخلفية"],
      photoshopMode: "RGB/8",
      afterEffectsImport: "Composition - Retain Layer Sizes",
    },
  },
  {
    filename: "book-pages.psd",
    body: bookPsd,
    expected: {
      width: 640,
      height: 720,
      rootLayers: ["+page_001", "+page_002"],
      photoshopMode: "RGB/8",
      afterEffectsImport: "Composition - Retain Layer Sizes",
    },
  },
];
for (const file of files) {
  await writeFile(join(outputDirectory, file.filename), file.body);
}
const manifest = {
  schemaVersion: 1,
  generatedBy: "npm run golden:adobe:generate",
  files: files.map((file) => ({
    filename: file.filename,
    sizeBytes: file.body.byteLength,
    sha256: createHash("sha256").update(file.body).digest("hex"),
    expected: file.expected,
  })),
};
await writeFile(
  join(outputDirectory, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(JSON.stringify(manifest, null, 2));

function backgroundLayer(pageNumber) {
  return {
    id: `golden-page-${pageNumber}-background`,
    parentId: null,
    kind: "raster",
    name: `+page_${String(pageNumber).padStart(3, "0")}_background`,
    visible: true,
    locked: true,
    opacity: 1,
    fixed: true,
    zIndex: 0,
    pageNumber,
    bounds: { x: 0, y: 0, width: 640, height: 360 },
    fillColor: "#ffffff",
  };
}

function textLayer(id, name, fullText, pageNumber, direction, zIndex) {
  return {
    id,
    parentId: null,
    kind: "text",
    name,
    visible: true,
    locked: false,
    opacity: 1,
    fixed: false,
    zIndex,
    pageNumber,
    bounds: { x: 100, y: 120, width: 440, height: 80 },
    fullText,
    readingOrder: 0,
    direction,
  };
}
