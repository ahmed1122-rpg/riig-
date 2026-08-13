import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  type DocumentProcessingError,
  preparePdfSource,
} from "./index.js";

const fixtures = new URL(
  "../../../artifacts/fixtures/",
  import.meta.url,
);

describe("committed PDF compatibility matrix", () => {
  it("extracts mixed page sizes, rotation, crop box, vectors, and transparency", async () => {
    const source = await readFile(
      new URL("motionprep-layout-matrix.pdf", fixtures),
    );

    const document = await preparePdfSource({
      projectId: "project-fixture",
      sourceVersionId: "source-layout",
      source,
      separationMode: "line",
    });

    expect(document.pages).toHaveLength(3);
    expect(document.pages?.map(({ width, height }) => [width, height])).toEqual([
      [720, 400],
      [650, 380],
      [240, 240],
    ]);
    expect(
      document.layers.filter(
        (layer) => layer.kind === "raster" && layer.fixed,
      ),
    ).toHaveLength(3);
    expect(document.layers.some((layer) =>
      layer.fullText?.includes("Landscape vector and transparency"),
    )).toBe(true);
  });

  it("rejects the committed over-limit document deterministically", async () => {
    const source = await readFile(
      new URL("motionprep-page-limit.pdf", fixtures),
    );

    await expect(preparePdfSource({
      projectId: "project-fixture",
      sourceVersionId: "source-limit",
      source,
      separationMode: "line",
    })).rejects.toMatchObject({
      code: "PDF_TOO_MANY_PAGES",
    } satisfies Partial<DocumentProcessingError>);
  });

  it("rejects the committed truncated document with a stable code", async () => {
    const source = await readFile(
      new URL("motionprep-invalid.pdf", fixtures),
    );

    await expect(preparePdfSource({
      projectId: "project-fixture",
      sourceVersionId: "source-invalid",
      source,
      separationMode: "word",
    })).rejects.toMatchObject({
      code: "PDF_DECODE_FAILED",
    } satisfies Partial<DocumentProcessingError>);
  });
});
