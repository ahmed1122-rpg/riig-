import { Icon } from "../../shared/Icon";

export type PreviewBackground = "dark" | "white" | "checker";

interface PreviewToolbarProps {
  zoom: number;
  background: PreviewBackground;
  grid: boolean;
  safeBounds: boolean;
  solo: boolean;
  focusMode: boolean;
  onZoomChange: (zoom: number) => void;
  onBackgroundChange: (background: PreviewBackground) => void;
  onGridChange: (value: boolean) => void;
  onSafeBoundsChange: (value: boolean) => void;
  onSoloChange: (value: boolean) => void;
  onFocusModeChange: (value: boolean) => void;
  onFit: () => void;
}

export function PreviewToolbar({
  zoom,
  background,
  grid,
  safeBounds,
  solo,
  focusMode,
  onZoomChange,
  onBackgroundChange,
  onGridChange,
  onSafeBoundsChange,
  onSoloChange,
  onFocusModeChange,
  onFit,
}: PreviewToolbarProps) {
  const setZoom = (value: number) => onZoomChange(Math.max(25, Math.min(200, value)));

  return (
    <div className="pro-preview-toolbar" role="toolbar" aria-label="أدوات المعاينة">
      {/* Group A: Zoom controls */}
      <div className="pro-toolbar-group" role="group" aria-label="أدوات التكبير">
        <div className="pro-preview-control pro-zoom-control">
          <button type="button" aria-label="تكبير المعاينة إلى 75 بالمئة" onClick={() => setZoom(75)}>75%</button>
          <button type="button" aria-label="حجم 100 بالمئة" onClick={() => setZoom(100)}>100%</button>
          <button type="button" aria-label="تصغير المعاينة" onClick={() => setZoom(zoom - 10)}><Icon name="zoomOut" size={15} /></button>
          <input aria-label="تكبير المعاينة" type="range" min="25" max="200" step="5" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          <button type="button" aria-label="تكبير المعاينة" onClick={() => setZoom(zoom + 10)}><Icon name="zoomIn" size={15} /></button>
          <button type="button" aria-label="توسيط واحتواء اللوحة" onClick={onFit}><Icon name="fitCanvas" size={15} /></button>
          <output dir="ltr">{zoom}%</output>
        </div>
      </div>

      <span className="pro-toolbar-sep" aria-hidden="true" />

      {/* Group B: Display mode & toggles */}
      <div className="pro-toolbar-group" role="group" aria-label="خيارات العرض">
        <div className="pro-preview-control pro-background-control" role="group" aria-label="خلفية المعاينة">
          {(["dark", "white", "checker"] as const).map((item) => (
            <button
              key={item}
              type="button"
              className={background === item ? "is-active" : ""}
              aria-pressed={background === item}
              onClick={() => onBackgroundChange(item)}
            >
              <i className={`preview-swatch preview-swatch--${item}`} />
              {item === "dark" ? "داكن" : item === "white" ? "أبيض" : "شفاف"}
            </button>
          ))}
        </div>

        <div className="pro-preview-control pro-view-toggles">
          <button type="button" className={grid ? "is-active" : ""} aria-pressed={grid} onClick={() => onGridChange(!grid)}><Icon name="grid" size={14} /> الشبكة</button>
          <button type="button" className={safeBounds ? "is-active" : ""} aria-pressed={safeBounds} onClick={() => onSafeBoundsChange(!safeBounds)}><Icon name="boxSelect" size={14} /> الحدود</button>
          <button type="button" className={solo ? "is-active" : ""} aria-pressed={solo} onClick={() => onSoloChange(!solo)}><Icon name="eye" size={14} /> منفرد</button>
        </div>
      </div>

      <span className="pro-toolbar-sep" aria-hidden="true" />

      {/* Group C: Focus Mode */}
      <div className="pro-toolbar-group pro-toolbar-end">
        <button type="button" className="pro-focus-button" aria-pressed={focusMode} onClick={() => onFocusModeChange(!focusMode)}>
          <Icon name={focusMode ? "close" : "boxSelect"} size={15} />
          {focusMode ? "إنهاء التركيز" : "تركيز المعاينة"}
        </button>
      </div>
    </div>
  );
}
