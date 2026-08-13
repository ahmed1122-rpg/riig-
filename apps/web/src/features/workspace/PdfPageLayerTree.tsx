import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Icon } from "../../shared/Icon";
import type { PdfLayerTreeNode, PdfPageFolder } from "./layerPageScope";

interface PdfPageLayerTreeProps {
  folders: readonly PdfPageFolder[];
  activePage: number;
  searchActive?: boolean;
  compact?: boolean;
  loading?: boolean;
  renderLayer: (node: PdfLayerTreeNode, pageNumber: number) => ReactNode;
  onPageChange: (pageNumber: number) => Promise<boolean> | boolean;
}

const INITIAL_PAGE_NODE_WINDOW = 80;
const PAGE_NODE_WINDOW_STEP = 160;

export function PdfPageLayerTree({
  folders,
  activePage,
  searchActive = false,
  compact = false,
  loading = false,
  renderLayer,
  onPageChange,
}: PdfPageLayerTreeProps) {
  const baseId = useId().replace(/:/g, "");
  const [expandedPages, setExpandedPages] = useState<ReadonlySet<number>>(
    () => new Set([activePage]),
  );
  const [pageLimits, setPageLimits] = useState<ReadonlyMap<number, number>>(
    () => new Map(),
  );
  const visibleFolders = useMemo(
    () =>
      searchActive
        ? folders.filter((folder) => folder.matchingContentCount > 0)
        : folders,
    [folders, searchActive],
  );

  useEffect(() => {
    setExpandedPages(new Set([activePage]));
  }, [activePage]);

  useEffect(() => {
    if (!searchActive) return;
    const firstMatch = visibleFolders[0];
    if (firstMatch) setExpandedPages(new Set([firstMatch.pageNumber]));
  }, [searchActive, visibleFolders]);

  if (!loading && visibleFolders.length === 0) {
    return (
      <div className="pro-layer-empty" role="status">
        <Icon name="search" size={19} />
        <strong>لا توجد طبقات مطابقة</strong>
        <span>جرّب اسمًا أو محتوى آخر، أو امسح البحث.</span>
      </div>
    );
  }

  return (
    <div
      className={`pdf-page-tree ${compact ? "is-compact" : ""}`}
      role="group"
      aria-label="مجلدات صفحات PDF"
    >
      {visibleFolders.map((folder) => {
        const expanded = expandedPages.has(folder.pageNumber);
        const nodeLimit =
          pageLimits.get(folder.pageNumber) ?? INITIAL_PAGE_NODE_WINDOW;
        const limited = expanded
          ? limitPdfTreeNodes(folder.nodes, nodeLimit)
          : { nodes: [], total: 0 };
        const contentId = `${baseId}-page-${folder.pageNumber}`;
        const current = folder.pageNumber === activePage;
        return (
          <section
            className={`pdf-page-folder ${current ? "is-current" : ""}`}
            key={folder.id}
            data-page-number={folder.pageNumber}
          >
            <button
              type="button"
              className="pdf-page-folder__header"
              aria-expanded={expanded}
              aria-controls={contentId}
              aria-current={current ? "page" : undefined}
              aria-label={`الصفحة ${folder.pageNumber}، ${folder.contentLayers.length} طبقات${current ? "، الصفحة الحالية" : ""}`}
              onClick={async () => {
                const accepted = await onPageChange(folder.pageNumber);
                if (!accepted) return;
                setExpandedPages((currentPages) => {
                  const next = new Set(currentPages);
                  if (expanded && !current) {
                    next.delete(folder.pageNumber);
                  } else {
                    return new Set([folder.pageNumber]);
                  }
                  return next;
                });
              }}
            >
              <Icon name="chevron" size={14} />
              <Icon name="folder" size={16} />
              <span className="pdf-page-folder__identity">
                <strong>
                  الصفحة <bdi>{String(folder.pageNumber).padStart(3, "0")}</bdi>
                </strong>
                <small dir="ltr">{folder.technicalName}</small>
              </span>
              <span className="pdf-page-folder__count">
                {searchActive
                  ? `${folder.matchingContentCount} مطابقة`
                  : `${folder.contentLayers.length} طبقات`}
              </span>
              {current && <em><Icon name="check" size={12} /> الصفحة الحالية</em>}
              {folder.virtual && <i title="مجلد توافق لمستند قديم">قديم</i>}
            </button>
            {expanded && <div
              id={contentId}
              className="pdf-page-folder__content"
              role="group"
              aria-label={`طبقات الصفحة ${folder.pageNumber}`}
            >
              {limited.nodes.length === 0 ? (
                <p className="pdf-page-folder__empty">هذه الصفحة بلا طبقات محتوى مطابقة.</p>
              ) : (
                limited.nodes.map((node) => (
                  <PdfTreeNode
                    key={node.layer.id}
                    node={node}
                    pageNumber={folder.pageNumber}
                    renderLayer={renderLayer}
                  />
                ))
              )}
              {limited.total > nodeLimit && (
                <button
                  type="button"
                  className="pdf-page-folder__more"
                  onClick={() => setPageLimits((currentLimits) => {
                    const next = new Map(currentLimits);
                    next.set(
                      folder.pageNumber,
                      nodeLimit + PAGE_NODE_WINDOW_STEP,
                    );
                    return next;
                  })}
                >
                  عرض {Math.min(PAGE_NODE_WINDOW_STEP, limited.total - nodeLimit)} طبقة إضافية
                </button>
              )}
            </div>}
          </section>
        );
      })}
    </div>
  );
}

function PdfTreeNode({
  node,
  pageNumber,
  renderLayer,
}: {
  node: PdfLayerTreeNode;
  pageNumber: number;
  renderLayer: PdfPageLayerTreeProps["renderLayer"];
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = useId();
  if (node.layer.kind !== "group") {
    return <>{renderLayer(node, pageNumber)}</>;
  }
  return (
    <div className="pdf-semantic-group">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <Icon name="chevron" size={12} />
        <Icon name="folder" size={14} />
        <strong>{node.layer.name}</strong>
        <span>{countDescendants(node)} طبقات</span>
      </button>
      <div id={contentId} hidden={!expanded}>
        {node.children.map((child) => (
          <PdfTreeNode
            key={child.layer.id}
            node={child}
            pageNumber={pageNumber}
            renderLayer={renderLayer}
          />
        ))}
      </div>
    </div>
  );
}

function countDescendants(node: PdfLayerTreeNode): number {
  return node.children.reduce(
    (count, child) =>
      count + (child.layer.kind === "group" ? countDescendants(child) : 1),
    0,
  );
}

function limitPdfTreeNodes(
  nodes: readonly PdfLayerTreeNode[],
  limit: number,
): { nodes: PdfLayerTreeNode[]; total: number } {
  let remaining = limit;
  let total = 0;
  const visit = (items: readonly PdfLayerTreeNode[]): PdfLayerTreeNode[] => {
    const limited: PdfLayerTreeNode[] = [];
    for (const node of items) {
      total += 1;
      if (remaining <= 0) {
        total += countTreeNodes(node.children);
        continue;
      }
      remaining -= 1;
      limited.push({
        layer: node.layer,
        children: visit(node.children),
      });
    }
    return limited;
  };
  return { nodes: visit(nodes), total };
}

function countTreeNodes(nodes: readonly PdfLayerTreeNode[]): number {
  return nodes.reduce(
    (count, node) => count + 1 + countTreeNodes(node.children),
    0,
  );
}
