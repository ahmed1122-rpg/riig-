import { access } from "node:fs/promises";
import { join } from "node:path";
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
    await expect(
      access(
        join(
          deterministicPdfJsOptions.standardFontDataUrl,
          "LiberationSans-Regular.ttf",
        ),
      ),
    ).resolves.toBeUndefined();
  });
});
