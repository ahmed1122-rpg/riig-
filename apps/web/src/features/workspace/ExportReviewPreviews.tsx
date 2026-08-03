import type { CSSProperties } from "react";
import type { Layer } from "../../types";
import { RasterLayerPreview } from "./RasterLayerPreview";

export function ExportCharacterPreview({
  layers,
  selectedLayerId,
  safeBounds,
  sourcePreviewUrl,
  canvasWidth = 1,
  canvasHeight = 1,
}: {
  layers: Layer[];
  selectedLayerId: string;
  safeBounds: boolean;
  sourcePreviewUrl?: string;
  canvasWidth?: number;
  canvasHeight?: number;
}) {
  const visible = (id: string) => layers.find((layer) => layer.id === id)?.visible !== false;
  const hasRealPreview = Boolean(sourcePreviewUrl) || layers.some((layer) => layer.previewUrl);
  return (
    <div className={`export-image-board ${hasRealPreview ? "has-source" : ""} ${safeBounds ? "show-safe-bounds" : ""}`}>
      <div className="artboard-grid" />
      {hasRealPreview ? (
        <RasterLayerPreview
          layers={layers}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          selectedLayerId={selectedLayerId}
          {...(sourcePreviewUrl ? { fallbackSourceUrl: sourcePreviewUrl } : {})}
          label="معاينة المصدر الحقيقي قبل التصدير"
          className="export-source-image"
        />
      ) : (
        <div className="character" aria-label="معاينة إرشادية للشخصية قبل رفع المصدر">
          {visible("legs") && <span className={`character-legs ${selectedLayerId === "legs" ? "is-selected" : ""}`} />}
          {visible("body") && <span className={`character-body ${selectedLayerId === "body" ? "is-selected" : ""}`} />}
          {visible("arm-right") && <span className={`character-arm character-arm--right ${selectedLayerId === "arm-right" ? "is-selected" : ""}`} />}
          {visible("arm-left") && <span className={`character-arm character-arm--left ${selectedLayerId === "arm-left" ? "is-selected" : ""}`} />}
          {visible("head") && <span className={`character-head ${selectedLayerId === "head" ? "is-selected" : ""}`} />}
          {visible("eye-right") && <span className={`character-eye character-eye--right ${selectedLayerId === "eye-right" ? "is-selected" : ""}`} />}
          {visible("eye-left") && <span className={`character-eye character-eye--left ${selectedLayerId === "eye-left" ? "is-selected" : ""}`} />}
          {visible("mouth") && <span className={`character-mouth ${selectedLayerId === "mouth" ? "is-selected" : ""}`} />}
        </div>
      )}
      {safeBounds && <span className="safe-bound-label">Safe 90%</span>}
    </div>
  );
}

export function ExportPdfPreview({
  layers,
  selectedLayerId,
  safeBounds,
  page,
  pages = [],
}: {
  layers: Layer[];
  selectedLayerId: string;
  safeBounds: boolean;
  page: number;
  pages?: Array<{ pageNumber: number; width: number; height: number }>;
}) {
  const pageSize = pages.find((item) => item.pageNumber === page) ?? {
    pageNumber: page,
    width: Math.max(1, ...layers.filter((layer) => layer.pageNumber === page).map((layer) => (layer.bounds?.x ?? 0) + (layer.bounds?.width ?? 0))),
    height: Math.max(1, ...layers.filter((layer) => layer.pageNumber === page).map((layer) => (layer.bounds?.y ?? 0) + (layer.bounds?.height ?? 0))),
  };
  const contentLayers = layers.filter(
    (layer) => layer.pageNumber === page && layer.kind !== "page" && layer.visible && layer.bounds,
  );
  return (
    <article
      className={`export-pdf-page ${safeBounds ? "show-safe-bounds" : ""}`}
      aria-label={`معاينة الصفحة ${page} من المستند الحقيقي`}
      style={{ "--pdf-aspect": `${pageSize.width} / ${pageSize.height}` } as CSSProperties}
    >
      {contentLayers.map((layer) => {
        const bounds = layer.bounds!;
        return (
          <div
            key={layer.id}
            className={`export-pdf-layer ${selectedLayerId === layer.id ? "is-selected" : ""}`}
            dir={layer.direction ?? "auto"}
            style={{
              insetInlineStart: `${(bounds.x / pageSize.width) * 100}%`,
              top: `${(bounds.y / pageSize.height) * 100}%`,
              width: `${(bounds.width / pageSize.width) * 100}%`,
              height: `${(bounds.height / pageSize.height) * 100}%`,
              opacity: layer.opacity / 100,
              fontFamily: layer.fontFamily,
              fontSize: `${Math.max(6, Math.min(18, ((layer.fontSize ?? bounds.height) / pageSize.height) * 520))}px`,
            }}
          >
            {layer.fullContent ?? layer.name.replace(/^\+/, "").replace(/_/gu, " ")}
          </div>
        );
      })}
      {contentLayers.length === 0 && <p className="export-pdf-empty">لا توجد طبقات نص ظاهرة في هذه الصفحة.</p>}
      {safeBounds && <span className="safe-bound-label">Safe 90%</span>}
    </article>
  );
}
