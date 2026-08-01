import { degrees, PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { readFile, writeFile } from "node:fs/promises";

const pdf = await PDFDocument.create();
stabilizeMetadata(pdf);
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (const [title, body] of [
  [
    "MotionPrep E2E Title",
    "First animated sentence. Second moving sentence!",
  ],
  [
    "MotionPrep E2E Page Two",
    "Third animated sentence. Fourth moving sentence!",
  ],
]) {
  const page = pdf.addPage([500, 360]);
  page.drawText(title, {
    x: 48,
    y: 300,
    size: 26,
    font,
    color: rgb(0.05, 0.08, 0.07),
  });
  page.drawText(body, {
    x: 48,
    y: 250,
    size: 14,
    font,
    color: rgb(0.05, 0.08, 0.07),
  });
}
await writeFile(
  new URL("./motionprep-e2e.pdf", import.meta.url),
  await pdf.save(),
);

const scannedPdf = await PDFDocument.create();
stabilizeMetadata(scannedPdf);
const scanBytes = await readFile(
  new URL("../benchmarks/ocr-arabic/page.png", import.meta.url),
);
const scan = await scannedPdf.embedPng(scanBytes);
const scannedPage = scannedPdf.addPage([scan.width, scan.height]);
scannedPage.drawImage(scan, {
  x: 0,
  y: 0,
  width: scan.width,
  height: scan.height,
});
await writeFile(
  new URL("./motionprep-scanned-arabic.pdf", import.meta.url),
  await scannedPdf.save(),
);

const layoutPdf = await PDFDocument.create();
stabilizeMetadata(layoutPdf);
const layoutFont = await layoutPdf.embedFont(StandardFonts.Helvetica);
const landscape = layoutPdf.addPage([720, 400]);
landscape.drawRectangle({
  x: 36,
  y: 72,
  width: 648,
  height: 230,
  color: rgb(0.12, 0.45, 0.82),
  opacity: 0.35,
});
landscape.drawText("Landscape vector and transparency", {
  x: 54,
  y: 325,
  size: 24,
  font: layoutFont,
});
const rotated = layoutPdf.addPage([420, 720]);
rotated.setRotation(degrees(90));
rotated.setCropBox(20, 30, 380, 650);
rotated.drawText("Rotated page with an explicit crop box", {
  x: 48,
  y: 640,
  size: 18,
  font: layoutFont,
});
const compact = layoutPdf.addPage([240, 240]);
compact.drawText("Mixed page sizes and Latin 123", {
  x: 18,
  y: 180,
  size: 12,
  font: layoutFont,
});
await writeFile(
  new URL("./motionprep-layout-matrix.pdf", import.meta.url),
  await layoutPdf.save(),
);

const pageLimitPdf = await PDFDocument.create();
stabilizeMetadata(pageLimitPdf);
for (let pageNumber = 0; pageNumber < 251; pageNumber += 1) {
  pageLimitPdf.addPage([10, 10]);
}
await writeFile(
  new URL("./motionprep-page-limit.pdf", import.meta.url),
  await pageLimitPdf.save(),
);

await writeFile(
  new URL("./motionprep-invalid.pdf", import.meta.url),
  Buffer.from("%PDF-1.7\ntruncated-without-xref\n", "ascii"),
);

function stabilizeMetadata(document) {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  document.setTitle("MotionPrep deterministic test fixture");
  document.setAuthor("MotionPrep test suite");
  document.setProducer("MotionPrep deterministic fixture generator");
  document.setCreator("MotionPrep");
  document.setCreationDate(timestamp);
  document.setModificationDate(timestamp);
}
