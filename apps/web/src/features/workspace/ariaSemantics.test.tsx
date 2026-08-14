import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectsView } from "../projects/ProjectsView";
import { LayerDock } from "./LayerDock";
import { WorkspaceHeader, WorkspaceStatusBar } from "./WorkspaceChrome";
import { WorkspaceToolRail } from "./WorkspaceToolRail";

const noop = () => undefined;
const allowModeChange = async () => undefined;

describe("truthful selection semantics", () => {
  it("presents project filters as pressed buttons instead of incomplete tabs", () => {
    const markup = renderToStaticMarkup(
      <ProjectsView
        demoState="empty"
        authenticated={false}
        onRequireAuth={noop}
        onOpenWorkspace={noop}
      />,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('role="tablist"');
  });

  it("presents the workspace kind switch as pressed buttons", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceHeader
        mode="image"
        persistedSource={false}
        sourceName="source.png"
        saveState="unavailable"
        imageLayerCount={0}
        activePdfPage={1}
        pdfPageCount={1}
        pdfMode="lines"
        exportTriggerRef={createRef<HTMLButtonElement>()}
        onBack={noop}
        onModeChange={allowModeChange}
        onExport={noop}
      />,
    );

    expect(markup).toContain('role="group"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('aria-pressed="false"');
    expect(markup).toContain('<h1>');
    expect(markup).not.toContain('role="tablist"');
  });

  it("does not present dirty or conflicted review changes as saved", () => {
    const dirtyHeader = renderToStaticMarkup(
      <WorkspaceHeader
        mode="image"
        persistedSource
        sourceName="source.png"
        saveState="dirty"
        imageLayerCount={1}
        activePdfPage={1}
        pdfPageCount={1}
        pdfMode="lines"
        exportTriggerRef={createRef<HTMLButtonElement>()}
        onBack={noop}
        onModeChange={allowModeChange}
        onExport={noop}
      />,
    );
    const conflictFooter = renderToStaticMarkup(
      <WorkspaceStatusBar
        saveState="conflict"
        persistedSource
        sourceVersion={2}
        processing={false}
        mode="image"
        zoom={100}
      />,
    );

    expect(dirtyHeader).toContain("تعديلات بانتظار الحفظ");
    expect(dirtyHeader).not.toContain("كل التعديلات محفوظة");
    expect(conflictFooter).toContain("تعارض نسخة");
    expect(conflictFooter).not.toContain(">محفوظ<");
    expect(conflictFooter).toContain('role="status"');
    expect(conflictFooter).toContain('aria-live="polite"');
  });

  it("warns before an image project reaches the layer limit", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceHeader
        mode="image"
        persistedSource
        sourceName="source.png"
        saveState="saved"
        imageLayerCount={12}
        activePdfPage={1}
        pdfPageCount={1}
        pdfMode="lines"
        exportTriggerRef={createRef<HTMLButtonElement>()}
        onBack={noop}
        onModeChange={allowModeChange}
        onExport={noop}
      />,
    );

    expect(markup).toContain("layer-counter is-near-limit");
    expect(markup).toContain("اقترب المشروع من حد طبقات الصورة");
  });

  it("reports command failures separately from source readiness", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceStatusBar
        saveState="saved"
        persistedSource
        sourceVersion={3}
        processing={false}
        commandStatus={{
          phase: "error",
          label: "ترتيب القراءة",
          message: "تغيرت مراجعة المستند",
        }}
        mode="book"
        zoom={100}
      />,
    );

    expect(markup).toContain("فشل ترتيب القراءة");
    expect(markup).toContain('class="is-error"');
    expect(markup).toContain("المصدر v3");
  });

  it("links dock tabs to a panel and exposes interactive layers as named groups", () => {
    const markup = renderToStaticMarkup(
      <LayerDock
        mode="image"
        layers={[
          {
            id: "head",
            name: "+رأس",
            kind: "head",
            visible: true,
            locked: false,
            opacity: 100,
            color: "#0f9fbb",
          },
        ]}
        selectedIds={["head"]}
        activeId="head"
        collapsed={false}
        width={320}
        loading={false}
        onCollapsedChange={noop}
        onWidthChange={noop}
        onSelectionChange={noop}
        onLayersChange={noop}
        onLayerCommand={async () => undefined}
        onNotify={noop}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-controls=');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('role="group"');
    expect(markup).not.toContain('role="listitem"');
    expect(markup).toContain('aria-label="+رأس، محددة"');
    expect(markup).not.toContain('role="listbox"');
    expect(markup).not.toContain('role="option"');
  });

  it("keeps unavailable desktop tools focusable and describes the reason", () => {
    const markup = renderToStaticMarkup(
      <WorkspaceToolRail
        mode="book"
        tools={[{
          id: "pdf.region-ocr",
          mode: "book",
          label: "OCR",
          icon: "scanText",
          group: "document",
          availability: "ready",
          action: "pdf-region-ocr",
          requiresSource: true,
          available: false,
          unavailableReason: "يلزم تفعيل OCR في بيئة التشغيل.",
        }]}
        activeTool="pdf.heading"
        collapsed={false}
        onCollapsedChange={noop}
        onToolChange={noop}
      />,
    );

    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain('aria-describedby="desktop-tool-reason-pdf.region-ocr"');
    expect(markup).not.toContain(" disabled=");
    expect(markup).toContain("يلزم تفعيل OCR في بيئة التشغيل.");
  });
});
