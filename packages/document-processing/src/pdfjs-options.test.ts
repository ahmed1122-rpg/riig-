import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deterministicPdfJsOptions } from "./pdfjs-options.js";

describe("deterministicPdfJsOptions", () => {
  it("resolves bundled standard fonts without depending on host fonts", async () => {
    expect(deterministicPdfJsOptions).toMatchObject({
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      useWasm: false,
    });
    expect(deterministicPdfJsOptions.standardFontDataUrl).toMatch(
      /^file:\/\/\/.+\/$/,
    );
    await expect(
      access(
        fileURLToPath(
          new URL(
            "LiberationSans-Regular.ttf",
            deterministicPdfJsOptions.standardFontDataUrl,
          ),
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
