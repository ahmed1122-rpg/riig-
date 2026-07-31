import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
