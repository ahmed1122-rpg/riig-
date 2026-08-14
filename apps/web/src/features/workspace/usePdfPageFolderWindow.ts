import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type UIEventHandler,
} from "react";
import type { PdfPageFolder } from "./layerPageScope";

const DEFAULT_VIEWPORT_HEIGHT = 480;
const WINDOW_OVERSCAN_PX = 600;
const FOLDER_GAP_PX = 5;
const DESKTOP_HEADER_HEIGHT_PX = 48;
const COMPACT_HEADER_HEIGHT_PX = 50;
const DESKTOP_CONTENT_ROW_HEIGHT_PX = 42;
const COMPACT_CONTENT_ROW_HEIGHT_PX = 46;

export interface VirtualPdfFolderRow {
  folder: PdfPageFolder;
  height: number;
  top: number;
}

interface PdfPageFolderWindowOptions {
  compact: boolean;
  enabled: boolean;
  expandedPage: number | undefined;
  folders: readonly PdfPageFolder[];
  pageLimits: ReadonlyMap<number, number>;
}

export function usePdfPageFolderWindow({
  compact,
  enabled,
  expandedPage,
  folders,
  pageLimits,
}: PdfPageFolderWindowOptions): {
  containerRef: RefObject<HTMLDivElement | null>;
  onScroll: UIEventHandler<HTMLDivElement>;
  rows: readonly VirtualPdfFolderRow[];
  totalHeight: number;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_HEIGHT);

  const allRows = useMemo(() => {
    let top = 0;
    return folders.map((folder): VirtualPdfFolderRow => {
      const expanded = folder.pageNumber === expandedPage;
      const pageLimit = pageLimits.get(folder.pageNumber) ?? 80;
      const height = estimateFolderHeight(
        folder.contentLayers.length,
        expanded,
        pageLimit,
        compact,
      );
      const row = { folder, height, top };
      top += height;
      return row;
    });
  }, [compact, expandedPage, folders, pageLimits]);

  const lastRow = allRows[allRows.length - 1];
  const totalHeight = lastRow ? lastRow.top + lastRow.height : 0;
  const rows = useMemo(() => {
    if (!enabled) return allRows;
    const first = findFirstVisibleRow(
      allRows,
      scrollTop - WINDOW_OVERSCAN_PX,
    );
    const visibleBottom = scrollTop + viewportHeight + WINDOW_OVERSCAN_PX;
    const windowed: VirtualPdfFolderRow[] = [];
    for (let index = first; index < allRows.length; index += 1) {
      const row = allRows[index]!;
      if (row.top > visibleBottom) break;
      windowed.push(row);
    }
    const expandedRow = expandedPage === undefined
      ? undefined
      : allRows.find((row) => row.folder.pageNumber === expandedPage);
    if (expandedRow && !windowed.includes(expandedRow)) windowed.push(expandedRow);
    return windowed.sort((left, right) => left.top - right.top);
  }, [allRows, enabled, expandedPage, scrollTop, viewportHeight]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      if (container.clientHeight > 0) setViewportHeight(container.clientHeight);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (expandedPage === undefined) return;
    const container = containerRef.current;
    const expandedRow = allRows.find(
      (row) => row.folder.pageNumber === expandedPage,
    );
    if (!container || !expandedRow) return;
    const visibleBottom = container.scrollTop + viewportHeight;
    const rowBottom = expandedRow.top + Math.min(expandedRow.height, viewportHeight);
    if (
      expandedRow.top >= container.scrollTop &&
      rowBottom <= visibleBottom
    ) return;
    container.scrollTop = expandedRow.top;
    setScrollTop(expandedRow.top);
  }, [allRows, expandedPage, viewportHeight]);

  const onScroll: UIEventHandler<HTMLDivElement> = (event) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  return {
    containerRef,
    onScroll,
    rows,
    totalHeight,
  };
}

function estimateFolderHeight(
  nodeCount: number,
  expanded: boolean,
  pageLimit: number,
  compact: boolean,
): number {
  const headerHeight = compact
    ? COMPACT_HEADER_HEIGHT_PX
    : DESKTOP_HEADER_HEIGHT_PX;
  if (!expanded) return headerHeight + FOLDER_GAP_PX;
  const visibleNodeCount = Math.min(nodeCount, pageLimit);
  const contentRowHeight = compact
    ? COMPACT_CONTENT_ROW_HEIGHT_PX
    : DESKTOP_CONTENT_ROW_HEIGHT_PX;
  const loadMoreHeight = nodeCount > pageLimit ? 42 : 0;
  return (
    headerHeight +
    Math.max(44, visibleNodeCount * contentRowHeight + loadMoreHeight + 10) +
    FOLDER_GAP_PX
  );
}

function findFirstVisibleRow(
  rows: readonly VirtualPdfFolderRow[],
  visibleTop: number,
): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const row = rows[middle]!;
    if (row.top + row.height < visibleTop) low = middle + 1;
    else high = middle;
  }
  return low;
}
