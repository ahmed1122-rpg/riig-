import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";

const require = createRequire(import.meta.url);
const pdfJsPackageDirectory = dirname(require.resolve("pdfjs-dist/package.json"));

/**
 * Deterministic Node settings shared by complete-PDF and regional rendering.
 * The trailing separator is required by pdfjs when it appends font filenames.
 */
export const deterministicPdfJsOptions = {
  disableFontFace: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  useWasm: false,
  standardFontDataUrl: `${join(pdfJsPackageDirectory, "standard_fonts")}${sep}`,
} as const;
