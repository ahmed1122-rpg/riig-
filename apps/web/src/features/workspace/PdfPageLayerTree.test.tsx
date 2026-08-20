// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import { LayerDock } from "./LayerDock";
import { PdfPageLayerTree } from "./PdfPageLayerTree";
import { WorkspaceMobileSheet } from "./WorkspaceMobileSheet";
import { createPdfPageFolders } from "./layerPageScope";
import { getLayerCheckSummary } from "./layerChecks";

afterEach(cleanup);

const pageLayers: Layer[] = [
  pageGroup(1),
  background(1),
  textLayer("intro", 1, "+مقدمة", "مقدمة الكتاب"),
  pageGroup(2),
  background(2),
  textLayer("result", 2, "+نتيجة_فريدة", "نص في الصفحة الثانية"),
];

describe("PDF page layer tree", () => {
  it("exposes page disclosures and consistent current/total counts", () => {
    renderDock();

    expect(screen.getAllByText("2 في الصفحة / 4 إجمالًا")).toHaveLength(2);
    expect(screen.getByRole("status").textContent).toContain("2 صفحات · الصفحة الحالية 001");
    expect(screen.getByRole("button", { name: /الصفحة 1، 2 طبقات، الصفحة الحالية/u }).getAttribute("aria-expanded"))
      .toBe("true");
    expect(screen.getByRole("button", { name: /الصفحة 2، 2 طبقات/u }).getAttribute("aria-expanded"))
      .toBe("false");
  });

  it("searches all pages, reveals the matching folder, and selects the result", async () => {
    const onSelectionChange = vi.fn();
    renderDock({ onSelectionChange });

    fireEvent.change(screen.getByRole("textbox", { name: "بحث الطبقات" }), {
      target: { value: "الصفحة الثانية" },
    });

    expect(screen.queryByRole("button", { name: /الصفحة 1،/u })).toBeNull();
    expect(screen.getByRole("button", { name: /الصفحة 2، 2 طبقات/u }).getAttribute("aria-expanded"))
      .toBe("true");
    fireEvent.click(screen.getByLabelText("+نتيجة_فريدة، غير محددة"));
    expect(onSelectionChange).toHaveBeenCalledWith(["result"], "result");
  });

  it("keeps the target folder collapsed when guarded page navigation is rejected", async () => {
    const onPdfPageChange = vi.fn(async () => false);
    renderDock({ onPdfPageChange });
    const pageTwo = screen.getByRole("button", { name: /الصفحة 2، 2 طبقات/u });

    fireEvent.click(pageTwo);
    await waitFor(() => expect(onPdfPageChange).toHaveBeenCalledWith(2));
    expect(pageTwo.getAttribute("aria-expanded")).toBe("false");
  });

  it("labels the current mobile page and preserves the complete layer name", () => {
    render(
      <WorkspaceMobileSheet
        activePanel="layers"
        mode="book"
        persistedSource
        tools={[]}
        activeTool="pdf.heading"
        layers={pageLayers}
        selectedIds={["intro"]}
        activeLayerId="intro"
        activePdfPage={1}
        pdfPages={[{ pageNumber: 1 }, { pageNumber: 2 }]}
        layerCheckSummary={{
          issueCount: 0,
          title: "الفحص سليم",
          description: "لا توجد مشكلات",
          items: [],
          diagnostics: [],
        }}
        onClose={() => undefined}
        onUseTool={() => undefined}
        onSelectLayer={() => undefined}
        onPdfPageChange={async () => true}
        onLayersChange={() => undefined}
        onLayerCommand={async () => undefined}
        onNotify={() => undefined}
      />,
    );

    expect(screen.getByText("الصفحة الحالية").textContent?.trim()).toBe("الصفحة الحالية");
    expect(screen.getByRole("button", { name: "+مقدمة، محددة" }).getAttribute("title"))
      .toBe("+مقدمة");
  });

  it("does not mount collapsed children and bounds a large open page", () => {
    const manyLayers = [
      pageGroup(1),
      background(1),
      ...Array.from({ length: 320 }, (_, index) =>
        textLayer(`bulk-${index}`, 1, `+bulk_${index}`, `نص ${index}`),
      ),
      pageGroup(2),
      background(2),
      textLayer("hidden-page", 2, "+hidden_page", "صفحة مطوية"),
    ];
    render(
      <LayerDock
        mode="book"
        layers={manyLayers}
        pdfPages={[{ pageNumber: 1 }, { pageNumber: 2 }]}
        activePdfPage={1}
        selectedIds={["bulk-0"]}
        activeId="bulk-0"
        checkSummary={getLayerCheckSummary("book", manyLayers)}
        collapsed={false}
        width={320}
        loading={false}
        onCollapsedChange={() => undefined}
        onWidthChange={() => undefined}
        onSelectionChange={() => undefined}
        onPdfPageChange={async () => true}
        onLayersChange={() => undefined}
        onLayerCommand={async () => undefined}
        onNotify={() => undefined}
      />,
    );

    expect(document.querySelectorAll(".pro-layer-row").length).toBeLessThanOrEqual(160);
    expect(screen.queryByText("+hidden_page")).toBeNull();
    expect(screen.getByRole("button", { name: /عرض 160 طبقة إضافية/u })).toBeTruthy();
  }, 15_000);

  it("keeps the maximum 100k-layer fixture inside the initial DOM and runtime budgets", () => {
    const pageCount = 5_000;
    const perPage = 20;
    const startedAt = performance.now();
    const layers = Array.from({ length: pageCount * perPage }, (_, index) =>
      textLayer(
        `perf-${index}`,
        Math.floor(index / perPage) + 1,
        `+perf_${index}`,
        `نص ${index}`,
      ));
    const folders = createPdfPageFolders(
      layers,
      Array.from({ length: pageCount }, (_, index) => ({ pageNumber: index + 1 })),
    );
    const view = render(
      <PdfPageLayerTree
        folders={folders}
        activePage={1}
        onPageChange={async () => true}
        renderLayer={(node) => <button className="perf-layer-row">{node.layer.name}</button>}
      />,
    );

    expect(view.container.querySelectorAll(".perf-layer-row").length).toBeLessThanOrEqual(160);
    expect(view.container.querySelectorAll(".pdf-page-folder").length).toBeLessThan(40);
    expect(view.container.querySelectorAll("*").length).toBeLessThan(500);
    expect(view.container.querySelector('[role="list"], [role="listitem"]')).toBeNull();
    expect(view.container.querySelectorAll('[role="group"]').length).toBeGreaterThanOrEqual(2);
    expect(performance.now() - startedAt).toBeLessThan(8_000);
  }, 15_000);

  it("brings a newly active page into the virtual folder window", async () => {
    const pages = Array.from({ length: 5_000 }, (_, index) => ({
      pageNumber: index + 1,
    }));
    const folders = createPdfPageFolders([], pages);
    const renderTree = (activePage: number) => (
      <PdfPageLayerTree
        folders={folders}
        activePage={activePage}
        onPageChange={async () => true}
        renderLayer={(node) => <button>{node.layer.name}</button>}
      />
    );
    const view = render(renderTree(1));

    expect(screen.queryByRole("button", { name: /الصفحة 4500،/u })).toBeNull();
    view.rerender(renderTree(4_500));

    await waitFor(() => {
      expect(screen.getByRole("button", {
        name: /الصفحة 4500، 0 طبقات، الصفحة الحالية/u,
      })).toBeTruthy();
    });
    expect(view.container.querySelectorAll(".pdf-page-folder").length).toBeLessThan(40);
  });

  it("scrolls a small folder tree back to the externally selected page", async () => {
    const folders = createPdfPageFolders(
      [],
      Array.from({ length: 12 }, (_, index) => ({ pageNumber: index + 1 })),
    );
    const renderTree = (activePage: number) => (
      <PdfPageLayerTree
        folders={folders}
        activePage={activePage}
        onPageChange={async () => true}
        renderLayer={(node) => <button>{node.layer.name}</button>}
      />
    );
    const view = render(renderTree(12));
    const tree = view.container.querySelector<HTMLElement>(".pdf-page-tree")!;
    tree.scrollTop = 600;

    view.rerender(renderTree(1));

    await waitFor(() => expect(tree.scrollTop).toBe(0));
    expect(screen.getByRole("button", {
      name: /الصفحة 1، 0 طبقات، الصفحة الحالية/u,
    })).toBeTruthy();
  });
});

function renderDock(overrides: {
  onSelectionChange?: (ids: string[], activeId: string) => void;
  onPdfPageChange?: (pageNumber: number) => Promise<boolean>;
} = {}) {
  return render(
    <LayerDock
      mode="book"
      layers={pageLayers}
      pdfPages={[{ pageNumber: 1 }, { pageNumber: 2 }]}
      activePdfPage={1}
      selectedIds={["intro"]}
      activeId="intro"
      checkSummary={getLayerCheckSummary("book", pageLayers)}
      collapsed={false}
      width={320}
      loading={false}
      onCollapsedChange={() => undefined}
      onWidthChange={() => undefined}
      onSelectionChange={overrides.onSelectionChange ?? (() => undefined)}
      onPdfPageChange={overrides.onPdfPageChange ?? (async () => true)}
      onLayersChange={() => undefined}
      onLayerCommand={async () => undefined}
      onNotify={() => undefined}
    />,
  );
}

function pageGroup(pageNumber: number): Layer {
  return {
    id: `group-${pageNumber}`,
    parentId: null,
    name: `+page_${String(pageNumber).padStart(3, "0")}`,
    kind: "group",
    visible: true,
    locked: true,
    opacity: 100,
    color: "#607d8b",
    pageNumber,
  };
}

function background(pageNumber: number): Layer {
  return {
    id: `background-${pageNumber}`,
    parentId: `group-${pageNumber}`,
    name: `+page_${String(pageNumber).padStart(3, "0")}_background`,
    kind: "raster",
    presentationKind: "page",
    visible: true,
    locked: true,
    opacity: 100,
    color: "#fff",
    pageNumber,
  };
}

function textLayer(
  id: string,
  pageNumber: number,
  name: string,
  fullText: string,
): Layer {
  return {
    id,
    parentId: `group-${pageNumber}`,
    name,
    kind: "text",
    visible: true,
    locked: false,
    opacity: 100,
    color: "#3bb3a9",
    pageNumber,
    fullText,
  };
}
