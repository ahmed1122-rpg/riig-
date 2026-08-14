import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";
import type { LayerDocumentCommand } from "@motionprep/contracts";
import {
  canonicalLayerName,
  normalizeLayerName,
} from "@motionprep/layer-domain";
import { Icon } from "../../shared/Icon";
import type { Layer, ProjectMode } from "../../types";
import { getLayerCheckSummary } from "./layerChecks";
import { ChecksPanel, LayerSkeleton } from "./LayerDockPanels";
import { LayerDockInteractiveRow } from "./LayerDockInteractiveRow";
import { LayerCommandActivity } from "./LayerCommandActivity";
import { DocumentChangeActivity } from "./DocumentChangeActivity";
import type { DocumentChangeSummary } from "./documentChangeSummary";
import { LayerMetadataInspector } from "./LayerMetadataInspector";
import { PdfPageLayerTree } from "./PdfPageLayerTree";
import {
  createPdfPageFolders,
  layersForWorkspacePage,
  workspaceLayerCounts,
} from "./layerPageScope";
import {
  duplicateLayerIds,
  isLayerFilter,
  matchesLayerFilter,
  type LayerFilter,
} from "./layerDockSelectors";
import { useWorkspacePreference } from "./useWorkspacePreference";
import { useLayerCommandWorkflow } from "./useLayerCommandWorkflow";

type LayerDensity = "dense" | "comfortable";
const LAYER_WINDOW_SIZE = 32;

interface LayerDockProps {
  mode: ProjectMode;
  layers: Layer[];
  selectedIds: string[];
  activeId: string;
  collapsed: boolean;
  width: number;
  loading: boolean;
  activePdfPage?: number;
  pdfPages?: Array<{ pageNumber: number }>;
  canReorder?: boolean;
  documentChangeLog?: readonly DocumentChangeSummary[];
  onCollapsedChange: (value: boolean) => void;
  onWidthChange: (value: number) => void;
  onSelectionChange: (ids: string[], activeId: string) => void;
  onPdfPageChange?: (pageNumber: number) => Promise<boolean>;
  onLayersChange: (layers: Layer[]) => void;
  onLayerCommand: (command: LayerDocumentCommand) => Promise<void>;
  onNotify: (message: string) => void;
}

export function LayerDock({
  mode,
  layers,
  selectedIds,
  activeId,
  collapsed,
  width,
  loading,
  activePdfPage = 1,
  pdfPages = [],
  canReorder = true,
  documentChangeLog = [],
  onCollapsedChange,
  onWidthChange,
  onSelectionChange,
  onPdfPageChange = async () => true,
  onLayersChange,
  onLayerCommand,
  onNotify,
}: LayerDockProps) {
  const [tab, setTab] = useState<"layers" | "checks">("layers");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filter, setFilter] = useWorkspacePreference<LayerFilter>(
    "motionprep.layer-view-filter",
    "all",
    isLayerFilter,
  );
  const [density, setDensity] = useWorkspacePreference<LayerDensity>(
    "motionprep.layer-view-density",
    "dense",
    (value): value is LayerDensity =>
      value === "dense" || value === "comfortable",
  );
  const [expanded, setExpanded] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [anchorId, setAnchorId] = useState(activeId);
  const [windowStart, setWindowStart] = useState(0);
  const [draggedLayerId, setDraggedLayerId] = useState<string>();
  const [dragOverLayerId, setDragOverLayerId] = useState<string>();
  const dockRef = useRef<HTMLElement>(null);
  const layersTabId = useId();
  const checksTabId = useId();
  const layersPanelId = useId();
  const checksPanelId = useId();

  const commandWorkflow = useLayerCommandWorkflow({
    mode,
    activePdfPage,
    layers,
    selectedIds,
    onLayerCommand,
    onNotify,
  });
  const executeCommand = commandWorkflow.executeCommand;

  useEffect(() => {
    setSearch("");
    setWindowStart(0);
    setRenamingId(null);
    setRenameError("");
  }, [mode]);

  const filteredLayers = useMemo(() => {
    return layersForWorkspacePage(mode, layers, activePdfPage).filter(
      (layer) => matchesLayerFilter(layer, deferredSearch, filter),
    );
  }, [activePdfPage, deferredSearch, filter, layers, mode]);
  const pageFolders = useMemo(
    () =>
      createPdfPageFolders(layers, pdfPages, (layer) =>
        matchesLayerFilter(layer, deferredSearch, filter),
      ),
    [deferredSearch, filter, layers, pdfPages],
  );
  const layerCounts = useMemo(
    () => workspaceLayerCounts(mode, layers, activePdfPage, pdfPages),
    [activePdfPage, layers, mode, pdfPages],
  );
  const unpinnedLayers = useMemo(() => filteredLayers.filter((layer) => layer.kind !== "page"), [filteredLayers]);
  const pinnedBackgrounds = useMemo(
    () => filteredLayers.filter((layer) => layer.kind === "page"),
    [filteredLayers],
  );
  const windowedLayers = useMemo(
    () => unpinnedLayers.slice(windowStart, windowStart + LAYER_WINDOW_SIZE),
    [unpinnedLayers, windowStart],
  );
  const renderedLayers = useMemo(
    () => [...windowedLayers, ...pinnedBackgrounds],
    [pinnedBackgrounds, windowedLayers],
  );
  const duplicateIds = useMemo(
    () => duplicateLayerIds(layers, mode === "book"),
    [layers, mode],
  );
  const checkSummary = useMemo(
    () => getLayerCheckSummary(mode, layers),
    [layers, mode],
  );
  const activeLayer = layers.find((layer) => layer.id === activeId);

  useEffect(() => {
    setWindowStart(0);
  }, [deferredSearch, filter]);

  useEffect(() => {
    if (!activeId || collapsed || tab !== "layers") return;
    const frame = window.requestAnimationFrame(() => {
      const row = [...dockRef.current?.querySelectorAll<HTMLElement>(
        ".pro-layer-row[data-layer-id]",
      ) ?? []].find((candidate) => candidate.dataset.layerId === activeId);
      row?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, activePdfPage, collapsed, pageFolders, tab]);

  const selectLayer = (
    id: string,
    event: React.MouseEvent | React.KeyboardEvent,
  ) => {
    if (event.shiftKey) {
      const anchorIndex = layers.findIndex((layer) => layer.id === anchorId);
      const targetIndex = layers.findIndex((layer) => layer.id === id);
      if (anchorIndex < 0 || targetIndex < 0) {
        onSelectionChange([id], id);
        setAnchorId(id);
        return;
      }
      const start = Math.min(anchorIndex, targetIndex);
      const end = Math.max(anchorIndex, targetIndex);
      const target = layers[targetIndex];
      const anchor = layers[anchorIndex];
      if (
        !target ||
        !anchor ||
        target.kind === "group" ||
        anchor.kind === "group" ||
        (target.pageNumber ?? 1) !== (anchor.pageNumber ?? 1) ||
        (target.parentId ?? null) !== (anchor.parentId ?? null)
      ) {
        onSelectionChange([id], id);
        setAnchorId(id);
        return;
      }
      const range = layers
        .slice(Math.max(0, start), end + 1)
        .filter(
          (layer) =>
            layer.kind !== "group" &&
            (layer.pageNumber ?? 1) === (target.pageNumber ?? 1) &&
            (layer.parentId ?? null) === (target.parentId ?? null),
        )
        .map((layer) => layer.id);
      onSelectionChange(range, id);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((selectedId) => selectedId !== id)
        : [...selectedIds, id];
      onSelectionChange(next.length ? next : [id], id);
      setAnchorId(id);
      return;
    }
    onSelectionChange([id], id);
    setAnchorId(id);
  };

  const moveLayer = (id: string, direction: -1 | 1) => {
    const layer = layers.find((candidate) => candidate.id === id);
    if (!layer || !isLayerContentEditable(layer)) return;
    const siblings = layers.filter((candidate) =>
      candidate.kind !== "page" &&
      candidate.kind !== "group" &&
      (candidate.pageNumber ?? 1) === (layer.pageNumber ?? 1) &&
      (candidate.parentId ?? null) === (layer.parentId ?? null),
    );
    const index = siblings.findIndex((candidate) => candidate.id === id);
    const target = siblings[index + direction];
    if (!target) return;
    executeCommand({
      kind: "move-layer",
      layerId: id,
      targetLayerId: target.id,
      position: direction < 0 ? "before" : "after",
    });
  };

  const moveLayerTo = (sourceId: string, targetId: string) => {
    const source = layers.find((layer) => layer.id === sourceId);
    const target = layers.find((layer) => layer.id === targetId);
    if (
      !source ||
      !target ||
      source.id === target.id ||
      !isLayerContentEditable(source) ||
      !isLayerContentEditable(target)
    ) return;
    executeCommand({
      kind: "move-layer",
      layerId: source.id,
      targetLayerId: target.id,
      position: "before",
    });
  };

  const navigateLayer = (
    id: string,
    direction: "previous" | "next" | "first" | "last",
  ) => {
    const current = filteredLayers.findIndex((layer) => layer.id === id);
    if (current < 0 || filteredLayers.length === 0) return;
    const targetIndex =
      direction === "first"
        ? 0
        : direction === "last"
          ? filteredLayers.length - 1
          : Math.max(
              0,
              Math.min(
                filteredLayers.length - 1,
                current + (direction === "previous" ? -1 : 1),
              ),
            );
    const target = filteredLayers[targetIndex];
    if (!target || target.id === id) return;
    const unpinnedIndex = unpinnedLayers.findIndex(
      (layer) => layer.id === target.id,
    );
    if (unpinnedIndex >= 0) {
      setWindowStart(
        Math.floor(unpinnedIndex / LAYER_WINDOW_SIZE) * LAYER_WINDOW_SIZE,
      );
    }
    onSelectionChange([target.id], target.id);
    window.requestAnimationFrame(() => {
      const rows = document.querySelectorAll<HTMLElement>(
        ".pro-layer-row[data-layer-id]",
      );
      [...rows].find(
        (row) => row.dataset.layerId === target.id,
      )?.focus();
    });
  };

  const saveRename = (id: string) => {
    const layer = layers.find((item) => item.id === id);
    if (!layer || !isLayerContentEditable(layer)) return;
    const nextName = normalizeLayerName(
      renameDraft.trim() || `طبقة_${layers.indexOf(layer) + 1}`,
    );
    if (layers.some((item) =>
      item.id !== id &&
      canonicalLayerName(item.name) === canonicalLayerName(nextName) &&
      (item.pageNumber ?? 1) === (layer.pageNumber ?? 1) &&
      (item.parentId ?? null) === (layer.parentId ?? null)
    )) {
      setRenameError("الاسم مستخدم بالفعل. أضف وصفًا مميزًا.");
      return;
    }
    onLayersChange(layers.map((item) => item.id === id ? { ...item, name: nextName } : item));
    setRenamingId(null);
    setRenameError("");
    onNotify(`تم حفظ الاسم ${nextName}.`);
  };

  const resizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startWidth = width;
    let frame: number | null = null;
    let nextWidth = startWidth;
    const handleMove = (moveEvent: PointerEvent) => {
      nextWidth = Math.max(260, Math.min(430, startWidth + startX - moveEvent.clientX));
      if (frame === null) {
        frame = window.requestAnimationFrame(() => {
          onWidthChange(nextWidth);
          frame = null;
        });
      }
    };
    const handleEnd = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      onWidthChange(nextWidth);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleEnd);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleEnd, { once: true });
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    const tabs = ["layers", "checks"] as const;
    const currentIndex = tabs.indexOf(tab);
    let nextIndex: number | undefined;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex + 1) % tabs.length;
    if (event.key === "ArrowRight") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (!nextTab) return;
    setTab(nextTab);
    const tabButtons = event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabButtons?.[nextIndex]?.focus();
  };

  const renderLayerRow = (layer: Layer) => (
    <LayerDockInteractiveRow
      key={layer.id}
      layer={layer}
      selected={selectedIds.includes(layer.id)}
      active={activeId === layer.id}
      duplicate={duplicateIds.has(layer.id)}
      renaming={renamingId === layer.id}
      renameDraft={renameDraft}
      renameError={renameError}
      canReorder={canReorder && isLayerContentEditable(layer)}
      draggedLayerId={draggedLayerId}
      dragOverLayerId={dragOverLayerId}
      onRenameDraftChange={(value) => { setRenameDraft(value); setRenameError(""); }}
      onSelect={(event) => selectLayer(layer.id, event)}
      onStartRename={() => {
        if (!isLayerContentEditable(layer)) return;
        setRenamingId(layer.id);
        setRenameDraft(layer.name);
        setRenameError("");
      }}
      onSaveRename={() => saveRename(layer.id)}
      onCancelRename={() => { setRenamingId(null); setRenameError(""); }}
      onToggleVisible={() => {
        if (layer.kind === "page" || layer.fixed) {
          onNotify("خلفية PDF ثابتة وتبقى ظاهرة في التصدير.");
          return;
        }
        onLayersChange(layers.map((item) => item.id === layer.id ? { ...item, visible: !item.visible } : item));
      }}
      onToggleLock={() => {
        if (layer.kind === "page" || layer.fixed) {
          onNotify("خلفية PDF ثابتة وغير قابلة للتحرير.");
          return;
        }
        onLayersChange(layers.map((item) => item.id === layer.id ? { ...item, locked: !item.locked } : item));
      }}
      onMove={(direction) => moveLayer(layer.id, direction)}
      onNavigate={(direction) => navigateLayer(layer.id, direction)}
      onMoveTo={moveLayerTo}
      onDraggedLayerChange={setDraggedLayerId}
      onDragOverLayerChange={setDragOverLayerId}
    />
  );

  if (collapsed) {
    return (
      <aside className="pro-layer-dock is-collapsed" aria-label="رصيف الطبقات مطوي">
        <button type="button" className="pro-layer-expand" aria-label="توسيع رصيف الطبقات" onClick={() => onCollapsedChange(false)}>
          <Icon name="panelOpen" size={17} /><span>{layerCounts.totalLayerCount}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside ref={dockRef} className={`pro-layer-dock density-${density}`} aria-label="رصيف الطبقات" style={{ width }}>
      <button
        className="pro-dock-resizer"
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label="تغيير عرض رصيف الطبقات"
        aria-valuemin={260}
        aria-valuemax={430}
        aria-valuenow={width}
        onPointerDown={resizeStart}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onWidthChange(Math.min(430, width + 16));
          if (event.key === "ArrowRight") onWidthChange(Math.max(260, width - 16));
        }}
      />

      <header className="pro-dock-header">
        <div className="panel-tabs" role="tablist" aria-label="تفاصيل المشروع">
          <button id={layersTabId} type="button" role="tab" aria-selected={tab === "layers"} aria-controls={layersPanelId} tabIndex={tab === "layers" ? 0 : -1} className={tab === "layers" ? "is-active" : ""} onClick={() => setTab("layers")} onKeyDown={handleTabKeyDown}>الطبقات <span>{layerCounts.totalLayerCount}</span></button>
          <button id={checksTabId} type="button" role="tab" aria-selected={tab === "checks"} aria-controls={checksPanelId} tabIndex={tab === "checks" ? 0 : -1} className={tab === "checks" ? "is-active" : ""} onClick={() => setTab("checks")} onKeyDown={handleTabKeyDown}>الفحص <span className="check-count">{checkSummary.issueCount}</span></button>
        </div>
        <button className="pro-icon-button" type="button" aria-label="طي رصيف الطبقات" onClick={() => onCollapsedChange(true)}><Icon name="panelClose" size={16} /></button>
      </header>

      {tab === "checks" ? (
        <div id={checksPanelId} className="pro-layer-tabpanel pro-layer-tabpanel--checks" role="tabpanel" aria-labelledby={checksTabId} tabIndex={0}>
          <ChecksPanel mode={mode} layers={layers} />
        </div>
      ) : (
        <div id={layersPanelId} className="pro-layer-tabpanel pro-layer-tabpanel--layers" role="tabpanel" aria-labelledby={layersTabId} tabIndex={0}>
          <div className="pro-layer-tools">
            <label className="pro-layer-search">
              <Icon name="search" size={14} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالاسم أو المحتوى" aria-label="بحث الطبقات" />
              {search && <button type="button" aria-label="مسح البحث" onClick={() => setSearch("")}><Icon name="close" size={13} /></button>}
            </label>
            <div className="pro-layer-filter-row">
              <select value={filter} onChange={(event) => setFilter(event.target.value as LayerFilter)} aria-label="عرض الطبقات المحفوظ" title="يُحفظ هذا العرض تلقائيًا لمساحة العمل التالية">
                <option value="all">الكل</option>
                <option value="visible">ظاهرة</option>
                <option value="hidden">مخفية</option>
                <option value="locked">مقفلة</option>
                <option value="text">نص فقط</option>
                <option value="raster">Raster فقط</option>
                <option value="low-confidence">ثقة منخفضة</option>
              </select>
              <span className={selectedIds.length > 1 ? "is-active" : ""}><b>{selectedIds.length}</b> محددة</span>
              <button type="button" aria-label={density === "dense" ? "صفوف مريحة" : "صفوف كثيفة"} onClick={() => setDensity(density === "dense" ? "comfortable" : "dense")}>
                <Icon name={density === "dense" ? "grid" : "list"} size={14} /> {density === "dense" ? "مريح" : "كثيف"}
              </button>
            </div>
            <div className="pro-layer-compact-actions" aria-label="إجراءات الأسماء والترتيب">
              <button type="button" onClick={commandWorkflow.requestNormalize}>معاينة توحيد الأسماء</button>
              <button type="button" disabled={!canReorder} title={canReorder ? "عكس ترتيب الطبقات داخل كل مجلد" : "إعادة الترتيب تحتاج عقد حفظ على الخادم"} onClick={() => executeCommand({ kind: "arrange-reading-order", scope: { kind: "document" }, order: "reverse" })}>عكس الترتيب</button>
              {mode === "book" && <button type="button" disabled={!canReorder} title={canReorder ? "ترتيب الوحدات حسب الصفحة والموضع" : "ترتيب القراءة محفوظ من المعالجة الحالية"} onClick={() => executeCommand({ kind: "arrange-reading-order", scope: { kind: "document" }, order: "reading" })}>ترتيب القراءة</button>}
            </div>
            <LayerCommandActivity
              preview={commandWorkflow.normalizePreview}
              log={commandWorkflow.commandLog}
              onConfirm={commandWorkflow.confirmNormalize}
              onCancel={commandWorkflow.closeNormalizePreview}
            />
            <DocumentChangeActivity changes={documentChangeLog} />
          </div>

          {selectedIds.length > 1 && (
            <div className="pro-bulk-toolbar" role="toolbar" aria-label="إجراءات الطبقات المحددة">
              <strong>{selectedIds.length} طبقات</strong>
              <button type="button" onClick={() => executeCommand({ kind: "update-state", scope: { kind: "layers", layerIds: selectedIds }, visible: true })}><Icon name="eye" size={13} /> إظهار</button>
              <button type="button" onClick={() => executeCommand({ kind: "update-state", scope: { kind: "layers", layerIds: selectedIds }, visible: false })}><Icon name="eyeOff" size={13} /> إخفاء</button>
              <button type="button" onClick={() => executeCommand({ kind: "update-state", scope: { kind: "layers", layerIds: selectedIds }, locked: true })}><Icon name="lock" size={13} /> قفل</button>
              <button type="button" onClick={() => executeCommand({ kind: "update-state", scope: { kind: "layers", layerIds: selectedIds }, locked: false })}><Icon name="unlock" size={13} /> فتح</button>
            </div>
          )}

          {activeLayer && (
            <LayerMetadataInspector
              layer={activeLayer}
              layers={layers}
              onLayersChange={onLayersChange}
              onNotify={onNotify}
            />
          )}

          {mode === "book" ? (
            <div className="pdf-layer-count-summary" role="status">
              <strong>{layerCounts.currentPageLayerCount} في الصفحة / {layerCounts.totalLayerCount} إجمالًا</strong>
              <span>{layerCounts.pageCount} صفحات · الصفحة الحالية <bdi>{String(activePdfPage).padStart(3, "0")}</bdi></span>
            </div>
          ) : (
            <div className="pro-layer-list-heading">
              <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><Icon name="chevron" size={13} /> مجموعة الشخصية</button>
              <span>{filteredLayers.length} / {layerCounts.totalLayerCount}</span>
            </div>
          )}

          {mode === "image" && unpinnedLayers.length > LAYER_WINDOW_SIZE && (
            <div className="pro-layer-window" aria-label="نافذة عرض طبقات PDF">
              <span>
                عرض <b dir="ltr">{windowStart + 1}–{Math.min(windowStart + LAYER_WINDOW_SIZE, unpinnedLayers.length)}</b>
                {" "}من <strong dir="ltr">{unpinnedLayers.length}</strong> طبقة نصية
              </span>
              <div>
                <button type="button" disabled={windowStart === 0} onClick={() => setWindowStart(Math.max(0, windowStart - LAYER_WINDOW_SIZE))} aria-label="الدفعة السابقة"><Icon name="chevron" size={13} /></button>
                <button type="button" disabled={windowStart + LAYER_WINDOW_SIZE >= unpinnedLayers.length} onClick={() => setWindowStart(Math.min(Math.max(0, unpinnedLayers.length - LAYER_WINDOW_SIZE), windowStart + LAYER_WINDOW_SIZE))} aria-label="الدفعة التالية"><Icon name="chevron" size={13} /></button>
              </div>
            </div>
          )}

          {mode === "book" ? (
            loading ? <LayerSkeleton /> : (
              <PdfPageLayerTree
                folders={pageFolders}
                activePage={activePdfPage}
                searchActive={Boolean(deferredSearch.trim()) || filter !== "all"}
                onPageChange={onPdfPageChange}
                renderLayer={(node) => renderLayerRow(node.layer)}
              />
            )
          ) : (
            <div className="pro-layer-list" role="group" aria-label="قائمة الطبقات">
              {loading ? <LayerSkeleton /> : !expanded ? null : renderedLayers.length === 0 ? (
                <div className="pro-layer-empty"><Icon name="search" size={19} /><strong>لا توجد طبقات مطابقة</strong><span>جرّب اسمًا آخر أو ألغِ عامل التصفية.</span></div>
              ) : renderedLayers.map(renderLayerRow)}
              {unpinnedLayers.length > LAYER_WINDOW_SIZE && <p className="pro-window-note">تُعرض 32 طبقة في كل دفعة لحماية الأداء.</p>}
            </div>
          )}
          <footer className="pro-layer-footer">
            <span>{mode === "image" ? `${layerCounts.totalLayerCount} من ${MAX_IMAGE_LAYERS} طبقة` : `${layerCounts.currentPageLayerCount} في الصفحة / ${layerCounts.totalLayerCount} إجمالًا`}</span>
            <span>{canReorder ? "Alt + ↑↓ للترتيب" : "الترتيب محفوظ وغير قابل للتعديل حاليًا"}</span>
          </footer>
        </div>
      )}
    </aside>
  );
}

function isLayerContentEditable(layer: Layer): boolean {
  return layer.kind !== "page" && layer.kind !== "group" && !layer.fixed && !layer.locked;
}
