import type { PdfSegmentation } from "../types";

export const PDF_SEGMENTATION_STORAGE_KEY =
  "motionprep.settings.pdf-segmentation";

export const pdfSegmentationLabels: Record<PdfSegmentation, string> = {
  headings: "عناوين",
  topics: "موضوعات",
  sentences: "جمل",
  lines: "أسطر",
  words: "كلمات",
  characters: "حروف",
};

export const pdfSegmentationOptions = (
  Object.entries(pdfSegmentationLabels) as Array<[PdfSegmentation, string]>
).map(([value, label]) => ({ value, label }));

export function isPdfSegmentation(value: unknown): value is PdfSegmentation {
  return pdfSegmentationOptions.some((option) => option.value === value);
}

export const pdfApiModes: Record<
  PdfSegmentation,
  "heading" | "topic" | "sentence" | "line" | "word" | "character"
> = {
  headings: "heading",
  topics: "topic",
  sentences: "sentence",
  lines: "line",
  words: "word",
  characters: "character",
};

export function storedPdfSegmentation(): PdfSegmentation {
  try {
    const stored = window.localStorage.getItem(PDF_SEGMENTATION_STORAGE_KEY);
    const value = stored === null ? null : JSON.parse(stored) as unknown;
    return isPdfSegmentation(value) ? value : "sentences";
  } catch {
    return "sentences";
  }
}
