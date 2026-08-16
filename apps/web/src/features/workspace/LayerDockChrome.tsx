import type { Dispatch, SetStateAction } from "react";
import { MAX_IMAGE_LAYERS, type LayerDocumentCommand } from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { ProjectMode } from "../../types";
import {
  handleLayerDockTabKeyDown,
  startLayerDockResize,
  type LayerDockTab,
} from "./layerDockInteractions";

export function CollapsedLayerDock({
  layerCount,
  onExpand,
}: {
  layerCount: number;
  onExpand: () => void;
}) {
  return (
    <aside className="pro-layer-dock is-collapsed" aria-label="رصيف الطبقات مطوي">
      <button type="button" className="pro-layer-expand" aria-label="توسيع رصيف الطبقات" onClick={onExpand}>
        <Icon name="panelOpen" size={17} /><span>{layerCount}</span>
      </button>
    </aside>
  );
}

export function LayerDockHeader({
  width,
  onWidthChange,
  tab,
  setTab,
  layersTabId,
  checksTabId,
  layersPanelId,
  checksPanelId,
  layerCount,
  issueCount,
  onCollapse,
}: {
  width: number;
  onWidthChange: (value: number) => void;
  tab: LayerDockTab;
  setTab: Dispatch<SetStateAction<LayerDockTab>>;
  layersTabId: string;
  checksTabId: string;
  layersPanelId: string;
  checksPanelId: string;
  layerCount: number;
  issueCount: number;
  onCollapse: () => void;
}) {
  return (
    <>
      <button
        className="pro-dock-resizer"
        type="button"
        role="separator"
        aria-orientation="vertical"
        aria-label="تغيير عرض رصيف الطبقات"
        aria-valuemin={260}
        aria-valuemax={430}
        aria-valuenow={width}
        onPointerDown={(event) => startLayerDockResize(event, width, onWidthChange)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") onWidthChange(Math.min(430, width + 16));
          if (event.key === "ArrowRight") onWidthChange(Math.max(260, width - 16));
        }}
      />
      <header className="pro-dock-header">
        <div className="panel-tabs" role="tablist" aria-label="تفاصيل المشروع">
          <button id={layersTabId} type="button" role="tab" aria-selected={tab === "layers"} aria-controls={layersPanelId} tabIndex={tab === "layers" ? 0 : -1} className={tab === "layers" ? "is-active" : ""} onClick={() => setTab("layers")} onKeyDown={(event) => handleLayerDockTabKeyDown(event, tab, setTab)}>الطبقات <span>{layerCount}</span></button>
          <button id={checksTabId} type="button" role="tab" aria-selected={tab === "checks"} aria-controls={checksPanelId} tabIndex={tab === "checks" ? 0 : -1} className={tab === "checks" ? "is-active" : ""} onClick={() => setTab("checks")} onKeyDown={(event) => handleLayerDockTabKeyDown(event, tab, setTab)}>الفحص <span className="check-count">{issueCount}</span></button>
        </div>
        <button className="pro-icon-button" type="button" aria-label="طي رصيف الطبقات" onClick={onCollapse}><Icon name="panelClose" size={16} /></button>
      </header>
    </>
  );
}

export function LayerBulkToolbar({
  selectedIds,
  onExecute,
}: {
  selectedIds: string[];
  onExecute: (command: LayerDocumentCommand) => void;
}) {
  if (selectedIds.length <= 1) return null;
  const scope = { kind: "layers" as const, layerIds: selectedIds };
  return (
    <div className="pro-bulk-toolbar" role="toolbar" aria-label="إجراءات الطبقات المحددة">
      <strong>{selectedIds.length} طبقات</strong>
      <button type="button" onClick={() => onExecute({ kind: "update-state", scope, visible: true })}><Icon name="eye" size={13} /> إظهار</button>
      <button type="button" onClick={() => onExecute({ kind: "update-state", scope, visible: false })}><Icon name="eyeOff" size={13} /> إخفاء</button>
      <button type="button" onClick={() => onExecute({ kind: "update-state", scope, locked: true })}><Icon name="lock" size={13} /> قفل</button>
      <button type="button" onClick={() => onExecute({ kind: "update-state", scope, locked: false })}><Icon name="unlock" size={13} /> فتح</button>
    </div>
  );
}

export function LayerDockFooter({
  mode,
  currentPageLayerCount,
  totalLayerCount,
  canReorder,
}: {
  mode: ProjectMode;
  currentPageLayerCount: number;
  totalLayerCount: number;
  canReorder: boolean;
}) {
  return (
    <footer className="pro-layer-footer">
      <span>{mode === "image" ? `${totalLayerCount} من ${MAX_IMAGE_LAYERS} طبقة` : `${currentPageLayerCount} في الصفحة / ${totalLayerCount} إجمالًا`}</span>
      <span>{canReorder ? "Alt + ↑↓ للترتيب" : "الترتيب محفوظ وغير قابل للتعديل حاليًا"}</span>
    </footer>
  );
}
