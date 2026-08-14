import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const pdfJsPackageDirectory = dirname(require.resolve("pdfjs-dist/package.json"));
const standardFontDirectoryUrl = pathToFileURL(
  `${join(pdfJsPackageDirectory, "standard_fonts")}${sep}`,
).href;

/**
 * Deterministic Node settings shared by complete-PDF and regional rendering.
 * The trailing separator is required by pdfjs when it appends font filenames.
 */
export const deterministicPdfJsOptions = {
  disableFontFace: true,
  useSystemFonts: false,
  useWorkerFetch: false,
  useWasm: false,
  standardFontDataUrl: standardFontDirectoryUrl,
} as const;
