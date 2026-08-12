import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectsView } from "../projects/ProjectsView";
import { LayerDock } from "./LayerDock";
import { WorkspaceHeader, WorkspaceStatusBar } from "./WorkspaceChrome";

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
  });

  it("links dock tabs to a panel and exposes layers as selected list items", () => {
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
        onArrangeReadingOrder={noop}
        onNotify={noop}
      />,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-controls=');
    expect(markup).toContain('role="tabpanel"');
    expect(markup).toContain('role="list"');
    expect(markup).toContain('role="listitem"');
    expect(markup).toContain('aria-label="+رأس، محددة"');
    expect(markup).not.toContain('role="listbox"');
    expect(markup).not.toContain('role="option"');
  });
});
