/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api/transport";
import type { Layer } from "../../types";
import {
  ExportCharacterPreview,
  ExportPdfPreview,
  ExportReview,
} from "./ExportReview";

const sourceLayer: Layer = {
  id: "source",
  name: "+source",
  kind: "body",
  visible: true,
  locked: false,
  opacity: 75,
  color: "#3bb3a9",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ExportCharacterPreview", () => {
  it("renders the uploaded source instead of demo artwork", () => {
    const markup = renderToStaticMarkup(
      <ExportCharacterPreview
        layers={[sourceLayer]}
        selectedLayerId="source"
        safeBounds
        sourcePreviewUrl="blob:http://localhost/source"
      />,
    );

    expect(markup).toContain('src="blob:http://localhost/source"');
    expect(markup).toContain("معاينة المصدر الحقيقي قبل التصدير");
    expect(markup).toContain("opacity:0.75");
    expect(markup).not.toContain('class="character"');
  });

  it("does not render a hidden uploaded source", () => {
    const markup = renderToStaticMarkup(
      <ExportCharacterPreview
        layers={[{ ...sourceLayer, visible: false }]}
        selectedLayerId="source"
        safeBounds={false}
        sourcePreviewUrl="blob:http://localhost/source"
      />,
    );

    expect(markup).not.toContain("<img");
  });
});

describe("ExportReview production editing policy", () => {
  it("shows every server-side preflight blocker", async () => {
    const onCreateExport = vi.fn().mockRejectedValue(
      new ApiError(
        "REVIEW_PREFLIGHT_FAILED",
        "Document preflight failed.",
        422,
        "request-review",
        false,
        [
          {
            code: "INVALID_LAYER_PREFIX",
            message: "Layer name must start with one plus sign.",
            layerId: "source",
          },
          {
            code: "IMAGE_RASTER_ASSET_MISSING",
            message: "Raster asset is missing.",
            layerId: "source",
          },
        ],
      ),
    );
    const view = render(
      <ExportReview
        mode="image"
        layers={[sourceLayer]}
        selectedLayerId="source"
        onSelectedLayerChange={() => undefined}
        onLayersChange={() => undefined}
        onClose={() => undefined}
        onNotify={() => undefined}
        returnFocusTo={null}
        canExport
        onCreateExport={onCreateExport}
      />,
    );

    fireEvent.click(
      view.container.querySelector<HTMLButtonElement>(
        ".create-export-button",
      )!,
    );
    await waitFor(() =>
      expect(view.container.querySelectorAll(".export-preflight-issues li"))
        .toHaveLength(2),
    );
    expect(view.container.textContent).toContain(
      "Layer name must start with one plus sign.",
    );
    expect(view.container.textContent).toContain("Raster asset is missing.");
  });

  it("keeps export retryable after a transient failure", async () => {
    const onCreateExport = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(undefined);
    const onNotify = vi.fn();
    const view = render(
      <ExportReview
        mode="image"
        layers={[sourceLayer]}
        selectedLayerId="source"
        onSelectedLayerChange={() => undefined}
        onLayersChange={() => undefined}
        onClose={() => undefined}
        onNotify={onNotify}
        returnFocusTo={null}
        canExport
        sourcePreviewUrl="blob:http://localhost/source"
        onCreateExport={onCreateExport}
      />,
    );
    const createButton = view.container.querySelector<HTMLButtonElement>(
      ".create-export-button",
    );
    expect(createButton).not.toBeNull();

    fireEvent.click(createButton!);
    await waitFor(() => expect(onCreateExport).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        view.container.querySelector(".export-generation-message")?.textContent,
      ).toContain("network unavailable"),
    );
    expect(createButton?.disabled).toBe(false);

    fireEvent.click(createButton!);
    await waitFor(() => expect(onCreateExport).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(createButton?.classList.contains("is-done")).toBe(true),
    );
    expect(onCreateExport).toHaveBeenLastCalledWith("psd", {
      scale: 1,
      colorProfile: "sRGB",
      namingPresetId: "character-basic",
    });
    expect(onNotify).toHaveBeenCalledTimes(2);
  });

  it("allows persisted ordering without exposing unsupported merge operations", () => {
    const markup = renderToStaticMarkup(
      <ExportReview
        mode="image"
        layers={[sourceLayer]}
        selectedLayerId="source"
        onSelectedLayerChange={() => undefined}
        onLayersChange={() => undefined}
        onClose={() => undefined}
        onNotify={() => undefined}
        returnFocusTo={null}
        canExport
        sourcePreviewUrl="blob:http://localhost/source"
        onCreateExport={() => Promise.resolve()}
      />,
    );

    expect(markup).toContain(
      'title="يحفظ الترتيب تلقائيًا في وثيقة الطبقات"',
    );
    expect(markup).not.toContain("merge-split-actions");
  });

  it("reports the real PDF layer count without a synthetic estimate", () => {
    const pageLayer: Layer = {
      ...sourceLayer,
      id: "page-1",
      name: "+page_001_background",
      kind: "page",
      locked: true,
      pageNumber: 1,
    };
    const markup = renderToStaticMarkup(
      <ExportReview
        mode="book"
        layers={[pageLayer, { ...sourceLayer, kind: "text", pageNumber: 1 }]}
        selectedLayerId="source"
        onSelectedLayerChange={() => undefined}
        onLayersChange={() => undefined}
        onClose={() => undefined}
        onNotify={() => undefined}
        returnFocusTo={null}
        canExport
        pdfPages={[{ pageNumber: 1, width: 612, height: 792 }]}
        onCreateExport={() => Promise.resolve()}
      />,
    );

    expect(markup).toContain("2 طبقات فعلية في 1 صفحة");
    expect(markup).not.toContain("4,860");
  });
});

describe("ExportPdfPreview", () => {
  it("renders extracted PDF content at its real page-relative bounds", () => {
    const textLayer: Layer = {
      ...sourceLayer,
      id: "actual-title",
      name: "+العنوان_الفعلي",
      kind: "text",
      pageNumber: 2,
      fullContent: "النص المستخرج فعليًا",
      bounds: { x: 61.2, y: 79.2, width: 306, height: 79.2 },
      direction: "rtl",
    };
    const markup = renderToStaticMarkup(
      <ExportPdfPreview
        layers={[textLayer]}
        selectedLayerId="actual-title"
        safeBounds
        page={2}
        pages={[{ pageNumber: 2, width: 612, height: 792 }]}
      />,
    );

    expect(markup).toContain("النص المستخرج فعليًا");
    expect(markup).toContain("inset-inline-start:10%");
    expect(markup).toContain("top:10%");
    expect(markup).toContain("width:50%");
    expect(markup).not.toContain("مدن من الذاكرة");
    expect(markup).not.toContain("MotionPrep · معاينة التصدير");
  });
});
