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
import { useWorkspacePreference } from "./useWorkspacePreference";
import type {
  ReadyWorkspaceToolId,
  ResolvedWorkspaceTool,
} from "./workspaceToolRegistry";
import type { WorkspaceMobilePanel } from "./workspaceMobilePanel";
import { DocumentChangeActivity } from "./DocumentChangeActivity";
import type { DocumentChangeSummary } from "./documentChangeSummary";

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
  onSelectLayer: (layerId: string) => void;
  onPdfPageChange: (pageNumber: number) => Promise<boolean>;
  onLayersChange: (layers: Layer[]) => void;
  onLayerCommand: (command: LayerDocumentCommand) => Promise<void>;
  documentChangeLog?: readonly DocumentChangeSummary[];
  onNotify: (message: string) => void;
}) {
  const [layerWindowSize, setLayerWindowSize] = useState(64);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [filter, setFilter] = useWorkspacePreference<LayerFilter>(
    "motionprep.mobile-layer-filter",
    "all",
    isLayerFilter,
  );
  const pageLayers = layersForWorkspacePage(mode, layers, activePdfPage)
    .filter((layer) => matchesLayerFilter(layer, deferredSearch, filter));
  const visibleLayers = pageLayers.slice(0, layerWindowSize);
  const pageFolders = createPdfPageFolders(layers, pdfPages, (layer) =>
    matchesLayerFilter(layer, deferredSearch, filter));
  const layerCounts = workspaceLayerCounts(mode, layers, activePdfPage, pdfPages);
  const activeLayer = layers.find((layer) => layer.id === activeLayerId);
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
                  <Icon name={tool.icon} /><span>{tool.label}</span>
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
          </div>
          {mode === "book" ? (
            <PdfPageLayerTree
              folders={pageFolders}
              activePage={activePdfPage}
              compact
              onPageChange={onPdfPageChange}
              renderLayer={(node) => (
                <MobileLayerButton key={node.layer.id} layer={node.layer} active={activeLayerId === node.layer.id} onSelect={onSelectLayer} />
              )}
            />
          ) : visibleLayers.map((layer) => (
            <MobileLayerButton key={layer.id} layer={layer} active={activeLayerId === layer.id} onSelect={onSelectLayer} />
          ))}
          {mode === "image" && pageLayers.length > visibleLayers.length && (
            <button type="button" className="pro-mobile-layer-more" onClick={() => setLayerWindowSize((current) => current + 64)}>
              عرض 64 طبقة إضافية ({pageLayers.length - visibleLayers.length} متبقية)
            </button>
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
        </div>
      ) : <div className="pro-mobile-checks"><strong>بانتظار المصدر</strong><p>تبدأ الفحوص بعد رفع الملف وتجهيز الطبقات.</p></div>)}
    </section>
  );
}

function MobileLayerButton({ layer, active, onSelect }: { layer: Layer; active: boolean; onSelect: (layerId: string) => void }) {
  return (
    <button
      type="button"
      className={active ? "is-active" : ""}
      aria-label={`${layer.name}، ${active ? "محددة" : "غير محددة"}`}
      title={layer.name}
      onClick={() => onSelect(layer.id)}
    >
      <span style={{ background: layer.color }} /><strong dir="auto">{layer.name}</strong>
      <Icon name={layer.locked ? "lock" : layer.visible ? "eye" : "eyeOff"} size={14} />
    </button>
  );
}
