import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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

function stabilizeMetadata(document) {
  const timestamp = new Date("2026-01-01T00:00:00.000Z");
  document.setTitle("MotionPrep deterministic test fixture");
  document.setAuthor("MotionPrep test suite");
  document.setProducer("MotionPrep deterministic fixture generator");
  document.setCreator("MotionPrep");
  document.setCreationDate(timestamp);
  document.setModificationDate(timestamp);
}
