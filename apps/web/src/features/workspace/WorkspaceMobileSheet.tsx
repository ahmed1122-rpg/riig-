import { useDeferredValue, useState } from "react";
import { MAX_IMAGE_LAYERS, type LayerDocumentCommand } from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { Layer, ProjectMode } from "../../types";
import type { getLayerCheckSummary } from "./layerChecks";
import {
  createPdfPageFolders,
  layersForWorkspacePage,
  workspaceLayerCounts,
} from "./layerPageScope";
import { PdfPageLayerTree } from "./PdfPageLayerTree";
import { MobileLayerActions } from "./MobileLayerActions";
import { LayerMetadataInspector } from "./LayerMetadataInspector";
import {
  isLayerFilter,
  matchesLayerFilter,
  type LayerFilter,
} from "./layerDockSelectors";
import { useStoredPreference } from "../../shared/useStoredPreference";
import { isPageLayer } from "./workspaceLayerKinds";
import type {
  ReadyWorkspaceToolId,
  ResolvedWorkspaceTool,
} from "./workspaceToolRegistry";
import type { WorkspaceMobilePanel } from "./workspaceMobilePanel";
import { DocumentChangeActivity } from "./DocumentChangeActivity";
import type { DocumentChangeSummary } from "./documentChangeSummary";
import { VirtualLayerList } from "./VirtualLayerList";

const mobileBulkActions = [
  { label: "إظهار", icon: "eye", patch: { visible: true } },
  { label: "إخفاء", icon: "eyeOff", patch: { visible: false } },
  { label: "قفل", icon: "lock", patch: { locked: true } },
  { label: "فتح", icon: "unlock", patch: { locked: false } },
] as const;

export function WorkspaceMobileSheet({
  activePanel,
  mode,
  persistedSource,
  tools,
  activeTool,
  layers,
  selectedIds,
  activeLayerId,
  activePdfPage,
  pdfPages,
  layerCheckSummary,
  onClose,
  onUseTool,
  onSelectLayer,
  onPdfPageChange,
  onLayersChange,
  onLayerCommand,
  documentChangeLog = [],
  onNotify,
}: {
  activePanel: Exclude<WorkspaceMobilePanel, "none">;
  mode: ProjectMode;
  persistedSource: boolean;
  tools: readonly ResolvedWorkspaceTool[];
  activeTool: ReadyWorkspaceToolId;
  layers: readonly Layer[];
  selectedIds: readonly string[];
  activeLayerId: string;
  activePdfPage: number;
  pdfPages: Array<{ pageNumber: number }>;
  layerCheckSummary: ReturnType<typeof getLayerCheckSummary>;
  onClose: () => void;
  onUseTool: (tool: ResolvedWorkspaceTool) => void;
  onSelectLayer: (layerId: string, nextSelectedIds?: string[]) => void;
  onPdfPageChange: (pageNumber: number) => Promise<boolean>;
  onLayersChange: (layers: Layer[]) => void;
  onLayerCommand: (command: LayerDocumentCommand) => Promise<void>;
  documentChangeLog?: readonly DocumentChangeSummary[];
  onNotify: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [multiSelect, setMultiSelect] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const [filter, setFilter] = useStoredPreference<LayerFilter>(
    "motionprep.mobile-layer-filter",
    "all",
    isLayerFilter,
  );
  const openDiagnosticLayer = async (layerId: string) => {
    const layer = layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;
    if (
      mode === "book" &&
      layer.pageNumber !== undefined &&
      layer.pageNumber !== activePdfPage &&
      !(await onPdfPageChange(layer.pageNumber))
    ) {
      return;
    }
    onSelectLayer(layer.id);
    onClose();
  };
  const pageLayers = layersForWorkspacePage(mode, layers, activePdfPage)
    .filter((layer) => matchesLayerFilter(layer, deferredSearch, filter));
  const pageFolders = createPdfPageFolders(layers, pdfPages, (layer) =>
    matchesLayerFilter(layer, deferredSearch, filter));
  const layerCounts = workspaceLayerCounts(mode, layers, activePdfPage, pdfPages);
  const activeLayer = layers.find((layer) => layer.id === activeLayerId);
  const selectMobileLayer = (layer: Layer) => {
    if (!multiSelect || layer.kind === "group" || isPageLayer(layer)) {
      onSelectLayer(layer.id, [layer.id]);
      return;
    }
    const selected = layers.filter((candidate) =>
      selectedIds.includes(candidate.id) &&
      candidate.kind !== "group" &&
      !isPageLayer(candidate) &&
      (candidate.pageNumber ?? 1) === (layer.pageNumber ?? 1) &&
      (candidate.parentId ?? null) === (layer.parentId ?? null));
    const sameScope = selected.length === selectedIds.length;
    const next = sameScope && selectedIds.includes(layer.id)
      ? selectedIds.filter((id) => id !== layer.id)
      : sameScope
        ? [...selectedIds, layer.id]
        : [layer.id];
    const normalizedSelection = next.length > 0 ? [...next] : [layer.id];
    const nextActiveLayerId = normalizedSelection.includes(layer.id)
      ? layer.id
      : normalizedSelection[normalizedSelection.length - 1] ?? layer.id;
    onSelectLayer(nextActiveLayerId, normalizedSelection);
  };
  const label = activePanel === "tools" ? "الأدوات" : activePanel === "layers" ? "الطبقات" : "الفحص";
  return (
    <section className="mobile-sheet pro-mobile-sheet" aria-label={label}>
      <button className="sheet-handle" type="button" aria-label="إغلاق اللوحة" onClick={onClose} />
      {activePanel === "tools" && (
        <div className="mobile-tools-panel">
          {!persistedSource && (
            <p id="mobile-tools-prerequisite" className="mobile-tools-prerequisite">
              <Icon name="info" size={15} />
              <span><strong>الأدوات بانتظار المصدر</strong> ارفع المصدر لتفعيل أدوات التحديد.</span>
            </p>
          )}
          <div className="mobile-tools" aria-describedby={!persistedSource ? "mobile-tools-prerequisite" : undefined}>
            {tools.map((tool) => (
              <div key={tool.id} className="mobile-tool-entry">
                <button
                  type="button"
                  aria-disabled={!tool.available}
                  title={tool.available ? tool.label : tool.unavailableReason}
                  {...(!tool.available && tool.unavailableReason ? { "aria-describedby": `mobile-tool-reason-${tool.id}` } : {})}
                  onClick={() => { if (tool.available) onUseTool(tool); }}
                  className={activeTool === tool.id ? "is-active" : ""}
                >
                  <Icon name={tool.icon} /><span>{tool.label}{tool.statusBadge && <em className="pro-tool-status">{tool.statusBadge}</em>}</span>
                  {tool.shortcut && <kbd>{tool.shortcut.label}</kbd>}
                </button>
                {!tool.available && tool.unavailableReason && <small id={`mobile-tool-reason-${tool.id}`}>{tool.unavailableReason}</small>}
              </div>
            ))}
          </div>
        </div>
      )}
      {activePanel === "layers" && (
        <div className="pro-mobile-layer-list">
          <header>
            <strong>{mode === "image" ? `${layerCounts.totalLayerCount} / ${MAX_IMAGE_LAYERS} طبقة` : `${layerCounts.currentPageLayerCount} في الصفحة / ${layerCounts.totalLayerCount} إجمالًا`}</strong>
            <span>{mode === "book" ? `${layerCounts.pageCount} صفحات` : `${selectedIds.length} محددة`}</span>
          </header>
          <div className="pro-mobile-layer-filters">
            <label>
              <span className="sr-only">البحث في الطبقات</span>
              <input type="search" value={search} placeholder="ابحث في كل الطبقات" onChange={(event) => setSearch(event.target.value)} />
            </label>
            <label>
              <span className="sr-only">تصفية الطبقات</span>
              <select value={filter} onChange={(event) => setFilter(event.target.value as LayerFilter)}>
                <option value="all">كل الطبقات</option>
                <option value="visible">الظاهرة</option>
                <option value="hidden">المخفية</option>
                <option value="locked">المقفلة</option>
                <option value="text">النصوص</option>
                <option value="raster">الصور</option>
                <option value="low-confidence">ثقة منخفضة</option>
              </select>
            </label>
            <button
              type="button"
              className={multiSelect ? "is-active" : ""}
              aria-pressed={multiSelect}
              onClick={() => setMultiSelect((current) => !current)}
            >
              <Icon name="layers" size={14} /> تحديد متعدد
            </button>
          </div>
          {multiSelect && selectedIds.length > 1 && (
            <div className="pro-mobile-bulk-toolbar" role="toolbar" aria-label="إجراءات الطبقات المحددة">
              <strong>{selectedIds.length} طبقات</strong>
              {mobileBulkActions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => void onLayerCommand({
                    kind: "update-state",
                    scope: { kind: "layers", layerIds: [...selectedIds] },
                    ...action.patch,
                  })}
                >
                  <Icon name={action.icon} size={13} /> {action.label}
                </button>
              ))}
            </div>
          )}
          {mode === "book" ? (
            <PdfPageLayerTree
              folders={pageFolders}
              activePage={activePdfPage}
              compact
              onPageChange={onPdfPageChange}
              renderLayer={(node) => (
                <MobileLayerButton key={node.layer.id} layer={node.layer} active={activeLayerId === node.layer.id} selected={selectedIds.includes(node.layer.id)} onSelect={selectMobileLayer} />
              )}
            />
          ) : (
            <VirtualLayerList
              items={pageLayers}
              itemKey={(layer) => layer.id}
              renderItem={(layer) => (
                <MobileLayerButton layer={layer} active={activeLayerId === layer.id} selected={selectedIds.includes(layer.id)} onSelect={selectMobileLayer} />
              )}
              rowHeight={44}
              activeKey={activeLayerId}
              className="pro-mobile-virtual-layer-list"
              ariaLabel="قائمة الطبقات الافتراضية للهاتف"
            />
          )}
          {activeLayer && (
            <>
              <MobileLayerActions
                layer={activeLayer}
                layers={layers}
                onLayersChange={onLayersChange}
                onLayerCommand={onLayerCommand}
                onNotify={onNotify}
              />
              <LayerMetadataInspector
                compact
                layer={activeLayer}
                layers={layers}
                onLayersChange={onLayersChange}
                onNotify={onNotify}
              />
            </>
          )}
          <DocumentChangeActivity changes={documentChangeLog} />
        </div>
      )}
      {activePanel === "checks" && (persistedSource ? (
        <div className="pro-mobile-checks">
          <strong>{layerCheckSummary.title}</strong><p>{layerCheckSummary.description}</p>
          {layerCheckSummary.items.map((item) => (
            <p key={item.id} className={item.valid ? "is-ok" : "is-review"}>
              <Icon name={item.icon} size={14} /> <span><b>{item.label}</b> · {item.message}</span>
            </p>
          ))}
          {layerCheckSummary.diagnostics.length > 0 && (
            <div className="pro-mobile-check-diagnostics">
              <strong>تفاصيل قابلة للتنقل</strong>
              {layerCheckSummary.diagnostics.map((diagnostic) =>
                diagnostic.layerId ? (
                  <button
                    key={diagnostic.id}
                    type="button"
                    onClick={() => void openDiagnosticLayer(diagnostic.layerId!)}
                  >
                    {diagnostic.message}
                  </button>
                ) : (
                  <p key={diagnostic.id}>{diagnostic.message}</p>
                ),
              )}
            </div>
          )}
        </div>
      ) : <div className="pro-mobile-checks"><strong>بانتظار المصدر</strong><p>تبدأ الفحوص بعد رفع الملف وتجهيز الطبقات.</p></div>)}
    </section>
  );
}

function MobileLayerButton({ layer, active, selected, onSelect }: { layer: Layer; active: boolean; selected: boolean; onSelect: (layer: Layer) => void }) {
  return (
    <button
      type="button"
      className={`${active ? "is-active" : ""} ${selected ? "is-selected" : ""}`.trim()}
      aria-pressed={selected}
      aria-label={`${layer.name}، ${selected ? "محددة" : "غير محددة"}`}
      title={layer.name}
      onClick={() => onSelect(layer)}
    >
      <span style={{ background: layer.color }} /><strong dir="auto">{layer.name}</strong>
      <Icon name={layer.locked ? "lock" : layer.visible ? "eye" : "eyeOff"} size={14} />
    </button>
  );
}
