import { memo, useEffect, useId, useMemo, useState } from "react";
import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { Layer, ProjectMode } from "../../types";
import { getLayerCheckSummary } from "./layerChecks";
import { reindexLayerOrder } from "./layerReviewState";

type LayerFilter = "all" | "visible" | "hidden" | "locked" | "warnings";
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
  canReorder?: boolean;
  onCollapsedChange: (value: boolean) => void;
  onWidthChange: (value: number) => void;
  onSelectionChange: (ids: string[], activeId: string) => void;
  onLayersChange: (layers: Layer[]) => void;
  onArrangeReadingOrder: () => void;
  onNotify: (message: string) => void;
}

function normalizeLayerName(value: string, fallback: string) {
  const clean = value.trim().replace(/^\++/, "").replace(/\s+/g, "_");
  return `+${clean || fallback}`;
}

function hasWarning(layer: Layer) {
  return typeof layer.confidence === "number" && layer.confidence < 90;
}

export function LayerDock({
  mode,
  layers,
  selectedIds,
  activeId,
  collapsed,
  width,
  loading,
  canReorder = true,
  onCollapsedChange,
  onWidthChange,
  onSelectionChange,
  onLayersChange,
  onArrangeReadingOrder,
  onNotify,
}: LayerDockProps) {
  const [tab, setTab] = useState<"layers" | "checks">("layers");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<LayerFilter>("all");
  const [density, setDensity] = useState<LayerDensity>("dense");
  const [expanded, setExpanded] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const [anchorId, setAnchorId] = useState(activeId);
  const [windowStart, setWindowStart] = useState(0);
  const layersTabId = useId();
  const checksTabId = useId();
  const layersPanelId = useId();
  const checksPanelId = useId();

  useEffect(() => {
    setSearch("");
    setFilter("all");
    setWindowStart(0);
    setRenamingId(null);
    setRenameError("");
  }, [mode]);

  const filteredLayers = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase("ar");
    return layers.filter((layer) => {
      const matchesSearch = !normalizedSearch
        || layer.name.toLocaleLowerCase("ar").includes(normalizedSearch)
        || layer.fullContent?.toLocaleLowerCase("ar").includes(normalizedSearch);
      const matchesFilter = filter === "all"
        || (filter === "visible" && layer.visible)
        || (filter === "hidden" && !layer.visible)
        || (filter === "locked" && layer.locked)
        || (filter === "warnings" && hasWarning(layer));
      return matchesSearch && matchesFilter;
    });
  }, [filter, layers, search]);
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
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    layers.forEach((layer) => counts.set(layer.name, (counts.get(layer.name) ?? 0) + 1));
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [layers]);
  const checkSummary = useMemo(
    () => getLayerCheckSummary(mode, layers),
    [layers, mode],
  );

  useEffect(() => {
    setWindowStart(0);
  }, [filter, search]);

  const updateSelected = (changes: Partial<Layer>) => {
    onLayersChange(layers.map((layer) => (
      selectedIds.includes(layer.id) && layer.kind !== "page" ? { ...layer, ...changes } : layer
    )));
  };

  const selectLayer = (
    id: string,
    event: React.MouseEvent | React.KeyboardEvent,
  ) => {
    if (event.shiftKey) {
      const anchorIndex = layers.findIndex((layer) => layer.id === anchorId);
      const targetIndex = layers.findIndex((layer) => layer.id === id);
      const [start, end] = [anchorIndex, targetIndex].sort((a, b) => a - b);
      const range = layers.slice(Math.max(0, start), end + 1).map((layer) => layer.id);
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
    const from = layers.findIndex((layer) => layer.id === id);
    const to = Math.max(0, Math.min(layers.length - 1, from + direction));
    if (from < 0 || from === to || layers[from].kind === "page" || layers[to].kind === "page") return;
    const next = [...layers];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onLayersChange(reindexLayerOrder(next));
    onNotify(`تم نقل ${moved.name} ${direction < 0 ? "لأعلى" : "لأسفل"}.`);
  };

  const saveRename = (id: string) => {
    const layer = layers.find((item) => item.id === id);
    if (!layer || layer.kind === "page") return;
    const nextName = normalizeLayerName(renameDraft, `طبقة_${layers.indexOf(layer) + 1}`);
    if (layers.some((item) => item.id !== id && item.name === nextName)) {
      setRenameError("الاسم مستخدم بالفعل. أضف وصفًا مميزًا.");
      return;
    }
    onLayersChange(layers.map((item) => item.id === id ? { ...item, name: nextName } : item));
    setRenamingId(null);
    setRenameError("");
    onNotify(`تم حفظ الاسم ${nextName}.`);
  };

  const normalizeAll = () => {
    const seen = new Map<string, number>();
    const next = layers.map((layer, index) => {
      if (layer.kind === "page") return layer;
      const base = normalizeLayerName(layer.name, `طبقة_${index + 1}`);
      const count = (seen.get(base) ?? 0) + 1;
      seen.set(base, count);
      return { ...layer, name: count === 1 ? base : `${base}_${count}` };
    });
    onLayersChange(next);
    onNotify("تم توحيد الأسماء بعلامة + واحدة ومعالجة الأسماء المكررة.");
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
    setTab(tabs[nextIndex]);
    const tabButtons = event.currentTarget.parentElement
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabButtons?.[nextIndex]?.focus();
  };

  if (collapsed) {
    return (
      <aside className="pro-layer-dock is-collapsed" aria-label="رصيف الطبقات مطوي">
        <button type="button" className="pro-layer-expand" aria-label="توسيع رصيف الطبقات" onClick={() => onCollapsedChange(false)}>
          <Icon name="panelOpen" size={17} /><span>{layers.length}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className={`pro-layer-dock density-${density}`} aria-label="رصيف الطبقات" style={{ width }}>
      <button
        className="pro-dock-resizer"
        type="button"
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
          <button id={layersTabId} type="button" role="tab" aria-selected={tab === "layers"} aria-controls={layersPanelId} tabIndex={tab === "layers" ? 0 : -1} className={tab === "layers" ? "is-active" : ""} onClick={() => setTab("layers")} onKeyDown={handleTabKeyDown}>الطبقات <span>{layers.length}</span></button>
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
              <select value={filter} onChange={(event) => setFilter(event.target.value as LayerFilter)} aria-label="تصفية الطبقات">
                <option value="all">الكل</option>
                <option value="visible">ظاهرة</option>
                <option value="hidden">مخفية</option>
                <option value="locked">مقفلة</option>
                <option value="warnings">تحذيرات</option>
              </select>
              <span className={selectedIds.length > 1 ? "is-active" : ""}><b>{selectedIds.length}</b> محددة</span>
              <button type="button" aria-label={density === "dense" ? "صفوف مريحة" : "صفوف كثيفة"} onClick={() => setDensity(density === "dense" ? "comfortable" : "dense")}>
                <Icon name={density === "dense" ? "grid" : "list"} size={14} /> {density === "dense" ? "مريح" : "كثيف"}
              </button>
            </div>
            <div className="pro-layer-compact-actions" aria-label="إجراءات الأسماء والترتيب">
              <button type="button" onClick={normalizeAll}>توحيد الأسماء</button>
              <button type="button" disabled={!canReorder} title={canReorder ? "عكس ترتيب الطبقات" : "إعادة الترتيب تحتاج عقد حفظ على الخادم"} onClick={() => onLayersChange(reindexLayerOrder([...layers.filter((layer) => layer.kind !== "page")].reverse().concat(layers.filter((layer) => layer.kind === "page"))))}>عكس الترتيب</button>
              {mode === "book" && <button type="button" disabled={!canReorder} title={canReorder ? "ترتيب الوحدات حسب الصفحة والموضع" : "ترتيب القراءة محفوظ من المعالجة الحالية"} onClick={onArrangeReadingOrder}>ترتيب القراءة</button>}
            </div>
          </div>

          {selectedIds.length > 1 && (
            <div className="pro-bulk-toolbar" role="toolbar" aria-label="إجراءات الطبقات المحددة">
              <strong>{selectedIds.length} طبقات</strong>
              <button type="button" onClick={() => updateSelected({ visible: true })}><Icon name="eye" size={13} /> إظهار</button>
              <button type="button" onClick={() => updateSelected({ locked: true })}><Icon name="lock" size={13} /> قفل</button>
              <button type="button" onClick={() => {
                onLayersChange(layers.map((layer) => selectedIds.includes(layer.id) && layer.kind !== "page"
                  ? { ...layer, name: normalizeLayerName(`مجموعة_${layer.name}`, "طبقة") }
                  : layer));
              }}>بادئة مجموعة</button>
            </div>
          )}

          <div className="pro-layer-list-heading">
            <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><Icon name="chevron" size={13} /> {mode === "image" ? "مجموعة الشخصية" : "الصفحة 001"}</button>
            <span>{filteredLayers.length} / {layers.length}</span>
          </div>

          {unpinnedLayers.length > LAYER_WINDOW_SIZE && (
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

          <div className="pro-layer-list" role="list" aria-label="قائمة الطبقات">
            {loading ? <LayerSkeleton /> : !expanded ? null : renderedLayers.length === 0 ? (
              <div className="pro-layer-empty"><Icon name="search" size={19} /><strong>لا توجد طبقات مطابقة</strong><span>جرّب اسمًا آخر أو ألغِ عامل التصفية.</span></div>
            ) : renderedLayers.map((layer) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                selected={selectedIds.includes(layer.id)}
                active={activeId === layer.id}
                duplicate={duplicateNames.has(layer.name)}
                renaming={renamingId === layer.id}
                renameDraft={renameDraft}
                renameError={renameError}
                canReorder={canReorder}
                onRenameDraftChange={(value) => { setRenameDraft(value); setRenameError(""); }}
                onSelect={(event) => selectLayer(layer.id, event)}
                onStartRename={() => {
                  if (layer.kind === "page") return;
                  setRenamingId(layer.id);
                  setRenameDraft(layer.name);
                  setRenameError("");
                }}
                onSaveRename={() => saveRename(layer.id)}
                onCancelRename={() => { setRenamingId(null); setRenameError(""); }}
                onToggleVisible={() => onLayersChange(layers.map((item) => item.id === layer.id ? { ...item, visible: !item.visible } : item))}
                onToggleLock={() => {
                  if (layer.kind === "page") {
                    onNotify("خلفية PDF ثابتة وغير قابلة للتحرير.");
                    return;
                  }
                  onLayersChange(layers.map((item) => item.id === layer.id ? { ...item, locked: !item.locked } : item));
                }}
                onMove={(direction) => moveLayer(layer.id, direction)}
              />
            ))}
            {unpinnedLayers.length > LAYER_WINDOW_SIZE && <p className="pro-window-note">الخلفية المثبتة تبقى ظاهرة، بينما تُعرض 32 طبقة نصية فقط لحماية الأداء.</p>}
          </div>
          <footer className="pro-layer-footer">
            <span>{mode === "image" ? `${layers.length} من ${MAX_IMAGE_LAYERS} طبقة` : `${layers.length} طبقات · بلا حد عددي`}</span>
            <span>{canReorder ? "Alt + ↑↓ للترتيب" : "الترتيب محفوظ وغير قابل للتعديل حاليًا"}</span>
          </footer>
        </div>
      )}
    </aside>
  );
}

interface LayerRowProps {
  layer: Layer;
  selected: boolean;
  active: boolean;
  duplicate: boolean;
  renaming: boolean;
  renameDraft: string;
  renameError: string;
  canReorder: boolean;
  onRenameDraftChange: (value: string) => void;
  onSelect: (event: React.MouseEvent | React.KeyboardEvent) => void;
  onStartRename: () => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onMove: (direction: -1 | 1) => void;
}

const LayerRow = memo(function LayerRow({
  layer,
  selected,
  active,
  duplicate,
  renaming,
  renameDraft,
  renameError,
  canReorder,
  onRenameDraftChange,
  onSelect,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onToggleVisible,
  onToggleLock,
  onMove,
}: LayerRowProps) {
  return (
    <div
      className={`pro-layer-row ${selected ? "is-selected" : ""} ${active ? "is-active" : ""} ${layer.kind === "page" ? "is-fixed" : ""}`}
      role="listitem"
      aria-label={`${layer.name}، ${selected ? "محددة" : "غير محددة"}`}
      aria-current={active ? "true" : undefined}
      tabIndex={active ? 0 : -1}
      onClick={onSelect}
      onDoubleClick={onStartRename}
      onKeyDown={(event) => {
        if (canReorder && event.altKey && event.key === "ArrowUp") { event.preventDefault(); onMove(-1); }
        if (canReorder && event.altKey && event.key === "ArrowDown") { event.preventDefault(); onMove(1); }
        if (event.key === " ") { event.preventDefault(); onSelect(event); }
        if (event.key === "F2" || event.key === "Enter") { event.preventDefault(); onStartRename(); }
      }}
    >
      <button className="pro-layer-grip" type="button" aria-label={`سحب ${layer.name}`} title={canReorder ? "اسحب أو استخدم Alt + الأسهم" : "إعادة الترتيب غير مدعومة لهذا المصدر"} disabled={!canReorder}><Icon name="grip" size={14} /></button>
      <span className="pro-layer-thumb" style={{ "--layer-color": layer.color } as React.CSSProperties}>
        {layer.kind === "text" ? "ن" : layer.kind === "page" ? <Icon name="scan" size={13} /> : <i />}
      </span>
      <div className="pro-layer-copy">
        {renaming ? (
          <div className="pro-inline-rename" onClick={(event) => event.stopPropagation()}>
            <label><span aria-hidden="true">+</span><input autoFocus value={renameDraft.replace(/^\++/, "")} aria-label={`إعادة تسمية ${layer.name}`} aria-invalid={Boolean(renameError)} onChange={(event) => onRenameDraftChange(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter") onSaveRename();
              if (event.key === "Escape") onCancelRename();
            }} /></label>
            <button type="button" aria-label="حفظ الاسم" onClick={onSaveRename}><Icon name="check" size={12} /></button>
            <button type="button" aria-label="إلغاء التسمية" onClick={onCancelRename}><Icon name="close" size={12} /></button>
            {renameError && <small role="alert">{renameError}</small>}
          </div>
        ) : (
          <>
            <strong dir={/^[A-Za-z0-9]/.test(layer.name.slice(1)) ? "ltr" : "rtl"}>{layer.name}</strong>
            <span>{layer.kind === "page" ? "خلفية ثابتة" : layer.kind === "text" ? "نص · قابل للتحريك" : `${layer.confidence ?? 94}% · جزء صورة`}</span>
          </>
        )}
      </div>
      {duplicate && <span className="pro-layer-warning" title="اسم مكرر"><Icon name="warning" size={13} /></span>}
      <div className="pro-layer-order">
        <button type="button" aria-label={`نقل ${layer.name} لأعلى`} onClick={(event) => { event.stopPropagation(); onMove(-1); }} disabled={layer.kind === "page" || !canReorder}><Icon name="arrowUp" size={12} /></button>
        <button type="button" aria-label={`نقل ${layer.name} لأسفل`} onClick={(event) => { event.stopPropagation(); onMove(1); }} disabled={layer.kind === "page" || !canReorder}><Icon name="arrowDown" size={12} /></button>
      </div>
      <button className="pro-layer-action" type="button" onClick={(event) => { event.stopPropagation(); onToggleVisible(); }} aria-label={layer.visible ? `إخفاء ${layer.name}` : `إظهار ${layer.name}`}><Icon name={layer.visible ? "eye" : "eyeOff"} size={14} /></button>
      <button className="pro-layer-action" type="button" onClick={(event) => { event.stopPropagation(); onToggleLock(); }} disabled={layer.kind === "page"} aria-label={layer.locked ? `فتح قفل ${layer.name}` : `قفل ${layer.name}`}><Icon name={layer.locked ? "lock" : "unlock"} size={13} /></button>
    </div>
  );
});

function LayerSkeleton() {
  return <div className="pro-layer-skeleton" aria-label="جارٍ تحميل الطبقات">{Array.from({ length: 7 }, (_, index) => <i key={index} />)}</div>;
}

function ChecksPanel({ mode, layers }: { mode: ProjectMode; layers: Layer[] }) {
  const summary = getLayerCheckSummary(mode, layers);
  return (
    <div className="checks-panel pro-checks-panel">
      <div className="check-summary"><span><Icon name="review" size={21} /></span><div><strong>{summary.title}</strong><small>{summary.description}</small></div></div>
      <ul>
        {summary.items.map((item) => (
          <li key={item.id} className={item.valid ? "is-ok" : "is-review"}>
            <Icon name={item.icon} size={15} />
            <span><strong>{item.label}</strong><small>{item.message}</small></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
