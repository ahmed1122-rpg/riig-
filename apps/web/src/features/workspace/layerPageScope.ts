import { isPdfPageRootGroup } from "@motionprep/presets";
import type { Layer, ProjectMode } from "../../types";

export interface PdfPageReference {
  pageNumber: number;
}

export interface PdfLayerTreeNode {
  layer: Layer;
  children: PdfLayerTreeNode[];
}

export interface PdfPageFolder {
  id: string;
  pageNumber: number;
  technicalName: string;
  rootLayer?: Layer;
  virtual: boolean;
  nodes: PdfLayerTreeNode[];
  contentLayers: Layer[];
  matchingContentCount: number;
}

export interface WorkspaceLayerCounts {
  currentPageLayerCount: number;
  totalLayerCount: number;
  pageCount: number;
}

function isStructuralLayer(layer: Layer): boolean {
  return layer.kind === "group";
}

function layerPageNumber(layer: Layer): number {
  return layer.pageNumber ?? 1;
}

export function contentLayers(layers: readonly Layer[]): Layer[] {
  return layers.filter((layer) => !isStructuralLayer(layer));
}

export function layersForWorkspacePage(
  mode: ProjectMode,
  layers: readonly Layer[],
  activePdfPage: number,
): Layer[] {
  if (mode === "image") return contentLayers(layers);
  return contentLayers(layers).filter(
    (layer) => layerPageNumber(layer) === activePdfPage,
  );
}

export function workspaceLayerCounts(
  mode: ProjectMode,
  layers: readonly Layer[],
  activePdfPage: number,
  pages: readonly PdfPageReference[] = [],
): WorkspaceLayerCounts {
  const allContent = contentLayers(layers);
  return {
    currentPageLayerCount:
      mode === "book"
        ? allContent.filter(
            (layer) => layerPageNumber(layer) === activePdfPage,
          ).length
        : allContent.length,
    totalLayerCount: allContent.length,
    pageCount:
      mode === "book" ? collectPdfPageNumbers(layers, pages).length : 0,
  };
}

export function createPdfPageFolders(
  layers: readonly Layer[],
  pages: readonly PdfPageReference[] = [],
  includeContent: (layer: Layer) => boolean = INCLUDE_ALL_CONTENT,
): PdfPageFolder[] {
  const layersByPage = new Map<number, Layer[]>();
  const pageNumbers = new Set<number>();
  for (const page of pages) {
    if (Number.isSafeInteger(page.pageNumber) && page.pageNumber > 0) {
      pageNumbers.add(page.pageNumber);
    }
  }
  for (const layer of layers) {
    const pageNumber = layerPageNumber(layer);
    pageNumbers.add(pageNumber);
    const pageLayers = layersByPage.get(pageNumber) ?? [];
    pageLayers.push(layer);
    layersByPage.set(pageNumber, pageLayers);
  }
  return [...pageNumbers]
    .sort((left, right) => left - right)
    .map((pageNumber) => {
      const pageLayers = layersByPage.get(pageNumber) ?? [];
      const rootLayer = pageLayers.find(
        (layer) =>
          layer.kind === "group" &&
          isPdfPageRootGroup({
            kind: "group",
            name: layer.name as `+${string}`,
            pageNumber,
            parentId: layer.parentId ?? null,
          }),
      );
      const allContent = contentLayers(pageLayers);
      const matchingContent = allContent.filter(includeContent);
      const nodes = buildPdfLayerTree(
        pageLayers.filter((layer) => layer.id !== rootLayer?.id),
        rootLayer?.id,
        includeContent,
      );
      return {
        id: rootLayer?.id ?? `virtual-pdf-page-${pageNumber}`,
        pageNumber,
        technicalName: `+page_${String(pageNumber).padStart(3, "0")}`,
        ...(rootLayer ? { rootLayer } : {}),
        virtual: !rootLayer,
        nodes,
        contentLayers: allContent,
        matchingContentCount: matchingContent.length,
      };
    });
}

function collectPdfPageNumbers(
  layers: readonly Layer[],
  pages: readonly PdfPageReference[],
): number[] {
  const pageNumbers = new Set<number>(
    pages
      .map((page) => page.pageNumber)
      .filter((pageNumber) => Number.isSafeInteger(pageNumber) && pageNumber > 0),
  );
  layers.forEach((layer) => pageNumbers.add(layerPageNumber(layer)));
  return [...pageNumbers].sort((left, right) => left - right);
}

function buildPdfLayerTree(
  layers: readonly Layer[],
  pageRootId: string | undefined,
  includeContent: (layer: Layer) => boolean,
): PdfLayerTreeNode[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const childrenByParent = new Map<string | null, Layer[]>();
  const rootKey = pageRootId ?? null;

  for (const layer of layers) {
    const candidateParent = layer.parentId ?? null;
    const parent =
      candidateParent === pageRootId || candidateParent === null
        ? rootKey
        : byId.has(candidateParent)
          ? candidateParent
          : rootKey;
    const children = childrenByParent.get(parent) ?? [];
    children.push(layer);
    childrenByParent.set(parent, children);
  }

  const visit = (
    parentId: string | null,
    ancestry: ReadonlySet<string>,
  ): PdfLayerTreeNode[] =>
    (childrenByParent.get(parentId) ?? [])
      .flatMap((layer): PdfLayerTreeNode[] => {
        if (ancestry.has(layer.id)) return [];
        if (!isStructuralLayer(layer)) {
          return includeContent(layer) ? [{ layer, children: [] }] : [];
        }
        const children = visit(layer.id, new Set(ancestry).add(layer.id));
        return children.length > 0 || includeContent === INCLUDE_ALL_CONTENT
          ? [{ layer, children }]
          : [];
      })
      .sort(comparePdfTreeNodes);

  return visit(rootKey, new Set());
}

const INCLUDE_ALL_CONTENT = (_layer: Layer) => true;

function comparePdfTreeNodes(
  left: PdfLayerTreeNode,
  right: PdfLayerTreeNode,
): number {
  const leftBackground = left.layer.kind === "page" ? 0 : 1;
  const rightBackground = right.layer.kind === "page" ? 0 : 1;
  return (
    leftBackground - rightBackground ||
    (left.layer.readingOrder ?? Number.MAX_SAFE_INTEGER) -
      (right.layer.readingOrder ?? Number.MAX_SAFE_INTEGER) ||
    (left.layer.zIndex ?? 0) - (right.layer.zIndex ?? 0) ||
    left.layer.name.localeCompare(right.layer.name, "ar")
  );
}
