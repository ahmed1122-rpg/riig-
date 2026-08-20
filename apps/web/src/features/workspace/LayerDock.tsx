import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  canonicalLayerName,
  normalizeLayerName,
} from "@motionprep/layer-domain";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";
import { ChecksPanel, LayerSkeleton } from "./LayerDockPanels";
import {
  LayerDockInteractiveRow,
  type LayerDropPosition,
  type LayerDropTarget,
} from "./LayerDockInteractiveRow";
import { LayerCommandActivity } from "./LayerCommandActivity";
import { DocumentChangeActivity } from "./DocumentChangeActivity";
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
import { useStoredPreference } from "../../shared/useStoredPreference";
import { useLayerCommandWorkflow } from "./useLayerCommandWorkflow";
import { VirtualLayerList } from "./VirtualLayerList";
import { layerReorderIssue } from "./layerReorderGuard";
import type { LayerDockTab } from "./layerDockInteractions";
import {
  CollapsedLayerDock,
  LayerBulkToolbar,
  LayerDockFooter,
  LayerDockHeader,
} from "./LayerDockChrome";
import {
  navigateLayerSelection,
  openLayerDiagnostic,
} from "./layerDockNavigation";
import { isPageLayer } from "./workspaceLayerKinds";
import type { LayerDensity, LayerDockProps } from "./layerDockTypes";
import { resolveLayerSelection } from "./layerDockSelection";

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
  checkSummary,
  onCollapsedChange,
  onWidthChange,
  onSelectionChange,
  onPdfPageChange = async () => true,
  onLayersChange,
  onLayerCommand,
  onNotify,
}: LayerDockProps) {
  const [tab, setTab] = useState<LayerDockTab>("layers");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filter, setFilter] = useStoredPreference<LayerFilter>(
    "motionprep.layer-view-filter",
    "all",
    isLayerFilter,
  );
  const [density, setDensity] = useStoredPreference<LayerDensity>(
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
  const [draggedLayerId, setDraggedLayerId] = useState<string>();
  const [dragOverTarget, setDragOverTarget] = useState<LayerDropTarget>();
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
  const unpinnedLayers = useMemo(() => filteredLayers.filter((layer) => !isPageLayer(layer)), [filteredLayers]);
  const pinnedBackgrounds = useMemo(
    () => filteredLayers.filter(isPageLayer),
    [filteredLayers],
  );
  const renderedLayers = useMemo(
    () => [...unpinnedLayers, ...pinnedBackgrounds],
    [pinnedBackgrounds, unpinnedLayers],
  );
  const duplicateIds = useMemo(
    () => duplicateLayerIds(layers, mode === "book"),
    [layers, mode],
  );
  const activeLayer = layers.find((layer) => layer.id === activeId);

  useEffect(() => {
    if (mode !== "book" || !activeId || collapsed || tab !== "layers") return;
    const frame = window.requestAnimationFrame(() => {
      const row = [...dockRef.current?.querySelectorAll<HTMLElement>(
        ".pro-layer-row[data-layer-id]",
      ) ?? []].find((candidate) => candidate.dataset.layerId === activeId);
      row?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeId, activePdfPage, collapsed, mode, pageFolders, tab]);

  const selectLayer = (
    id: string,
    event: React.MouseEvent | React.KeyboardEvent,
  ) => {
    onSelectionChange(resolveLayerSelection({
      layers,
      selectedIds,
      anchorId,
      targetId: id,
      shiftKey: event.shiftKey,
      toggleKey: event.ctrlKey || event.metaKey,
    }), id);
    setAnchorId(id);
  };

  const moveLayer = (id: string, direction: -1 | 1) => {
    const layer = layers.find((candidate) => candidate.id === id);
    if (!layer || !isLayerContentEditable(layer)) return;
    const siblings = layers.filter((candidate) =>
      !isPageLayer(candidate) &&
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

  const moveLayerTo = (
    sourceId: string,
    targetId: string,
    position: LayerDropPosition,
  ) => {
    const source = layers.find((layer) => layer.id === sourceId);
    const target = layers.find((layer) => layer.id === targetId);
    if (
      !source ||
      !target ||
      source.id === target.id ||
      !isLayerContentEditable(source) ||
      !isLayerContentEditable(target)
    ) return;
    const issue = layerReorderIssue(source, target);
    if (issue) {
      onNotify(issue);
      return;
    }
    executeCommand({
      kind: "move-layer",
      layerId: source.id,
      targetLayerId: target.id,
      position,
    });
  };

  const navigateLayer = (
    id: string,
    direction: "previous" | "next" | "first" | "last",
  ) => {
    navigateLayerSelection({
      layers: filteredLayers,
      layerId: id,
      direction,
      onSelectionChange,
    });
  };

  const openDiagnosticLayer = async (layerId: string) => {
    await openLayerDiagnostic({
      layerId,
      layers,
      mode,
      activePdfPage,
      dock: dockRef.current,
      onPdfPageChange,
      onSelectionChange,
      onActiveLayerChange: setAnchorId,
      onOpenLayers: () => setTab("layers"),
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
      dragOverTarget={dragOverTarget}
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
        if (isPageLayer(layer) || layer.fixed) {
          onNotify("خلفية PDF ثابتة وتبقى ظاهرة في التصدير.");
          return;
        }
        onLayersChange(layers.map((item) => item.id === layer.id ? { ...item, visible: !item.visible } : item));
      }}
      onToggleLock={() => {
        if (isPageLayer(layer) || layer.fixed) {
          onNotify("خلفية PDF ثابتة وغير قابلة للتحرير.");
          return;
        }
        onLayersChange(layers.map((item) => item.id === layer.id ? { ...item, locked: !item.locked } : item));
      }}
      onMove={(direction) => moveLayer(layer.id, direction)}
      onNavigate={(direction) => navigateLayer(layer.id, direction)}
      onMoveTo={moveLayerTo}
      onDraggedLayerChange={setDraggedLayerId}
      onDragOverTargetChange={(target) => {
        if (!target) {
          setDragOverTarget(undefined);
          return;
        }
        const source = layers.find(
          (candidate) => candidate.id === draggedLayerId,
        );
        const destination = layers.find(
          (candidate) => candidate.id === target.layerId,
        );
        setDragOverTarget(
          source && destination && !layerReorderIssue(source, destination)
            ? target
            : undefined,
        );
      }}
    />
  );

  if (collapsed) {
    return (
      <CollapsedLayerDock
        layerCount={layerCounts.totalLayerCount}
        onExpand={() => onCollapsedChange(false)}
      />
    );
  }

  return (
    <aside ref={dockRef} className={`pro-layer-dock density-${density}`} aria-label="رصيف الطبقات" style={{ width }}>
      <LayerDockHeader
        width={width}
        onWidthChange={onWidthChange}
        tab={tab}
        setTab={setTab}
        layersTabId={layersTabId}
        checksTabId={checksTabId}
        layersPanelId={layersPanelId}
        checksPanelId={checksPanelId}
        layerCount={layerCounts.totalLayerCount}
        issueCount={checkSummary.issueCount}
        onCollapse={() => onCollapsedChange(true)}
      />

      {tab === "checks" ? (
        <div id={checksPanelId} className="pro-layer-tabpanel pro-layer-tabpanel--checks" role="tabpanel" aria-labelledby={checksTabId} tabIndex={0}>
          <ChecksPanel
            summary={checkSummary}
            onSelectLayer={(layerId) => void openDiagnosticLayer(layerId)}
          />
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

          <LayerBulkToolbar
            selectedIds={selectedIds}
            onExecute={(command) => void executeCommand(command)}
          />

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
            loading ? <div className="pro-layer-list"><LayerSkeleton /></div> : !expanded ? null : renderedLayers.length === 0 ? (
                <div className="pro-layer-list">
                <div className="pro-layer-empty"><Icon name="search" size={19} /><strong>لا توجد طبقات مطابقة</strong><span>جرّب اسمًا آخر أو ألغِ عامل التصفية.</span></div>
                </div>
              ) : (
                <VirtualLayerList
                  items={renderedLayers}
                  itemKey={(layer) => layer.id}
                  renderItem={renderLayerRow}
                  rowHeight={density === "dense" ? 54 : 64}
                  activeKey={activeId}
                  className="pro-layer-list"
                  ariaLabel="قائمة الطبقات الافتراضية"
                />
              )
          )}
          <LayerDockFooter
            mode={mode}
            currentPageLayerCount={layerCounts.currentPageLayerCount}
            totalLayerCount={layerCounts.totalLayerCount}
            canReorder={canReorder}
          />
        </div>
      )}
    </aside>
  );
}

function isLayerContentEditable(layer: Layer): boolean {
  return !isPageLayer(layer) && layer.kind !== "group" && !layer.fixed && !layer.locked;
}
