import { useState } from "react";
import { Dialog } from "../../shared/Dialog";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";
import { RasterLayerPreview } from "./RasterLayerPreview";

interface ImageRasterOperationDialogProps {
  operation: "edge-refine" | "merge";
  layers: Layer[];
  onClose: () => void;
  onApply: (
    input:
      | { operation: "edge-refine"; radius: 1 | 2 | 3; strength: number }
      | { operation: "merge" },
  ) => Promise<void>;
}

export function ImageRasterOperationDialog({
  operation,
  layers,
  onClose,
  onApply,
}: ImageRasterOperationDialogProps) {
  const [radius, setRadius] = useState<1 | 2 | 3>(1);
  const [strength, setStrength] = useState(0.65);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const previewSize = mergePreviewSize(layers);

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onApply(
        operation === "edge-refine"
          ? { operation, radius, strength }
          : { operation },
      );
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر تنفيذ عملية Raster.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title={operation === "edge-refine" ? "تحسين الحواف" : "دمج طبقات Raster"}
      description={
        operation === "edge-refine"
          ? "ينشئ أصل PNG جديدًا للحافة المصقولة ويُبقي الأصل السابق في سجل المراجعات."
          : "يركب الطبقات حسب ترتيبها وشفافيتها، ثم يحفظ الناتج في طبقة جديدة قابلة للتراجع."
      }
      className="image-raster-operation-dialog"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            إلغاء
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={submitting}
            onClick={() => void submit()}
          >
            <Icon name={operation === "edge-refine" ? "scan" : "merge"} size={15} />
            {submitting ? "جارٍ إنشاء المراجعة…" : "تطبيق وحفظ مراجعة"}
          </button>
        </>
      }
    >
      <div className="image-raster-operation-body">
        <section>
          <strong>{layers.length === 1 ? "الطبقة المحددة" : "الطبقات المحددة"}</strong>
          <ul>
            {layers.map((layer) => (
              <li key={layer.id}>{layer.name}</li>
            ))}
          </ul>
        </section>
        {operation === "edge-refine" && (
          <div className="image-edge-controls">
            <label>
              <span>نطاق التنعيم</span>
              <select
                value={radius}
                onChange={(event) =>
                  setRadius(Number(event.target.value) as 1 | 2 | 3)
                }
              >
                <option value={1}>دقيق — 1px</option>
                <option value={2}>متوسط — 2px</option>
                <option value={3}>واسع — 3px</option>
              </select>
            </label>
            <label>
              <span>القوة {Math.round(strength * 100)}%</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={strength}
                onChange={(event) => setStrength(Number(event.target.value))}
              />
            </label>
          </div>
        )}
        {operation === "merge" && (
          <>
            <section className="image-merge-preview">
              <strong>معاينة التركيب قبل الدمج</strong>
              {layers.some((layer) => layer.previewUrl) ? (
                <RasterLayerPreview
                  layers={layers}
                  canvasWidth={previewSize.width}
                  canvasHeight={previewSize.height}
                  selectedLayerId=""
                  label="معاينة الطبقات بعد تركيبها"
                />
              ) : (
                <p>لا تتوفر صور معاينة محلية لهذه الطبقات؛ ستبقى عملية الدمج قابلة للتراجع.</p>
              )}
            </section>
            <p className="operation-caution">
              ستُستبدل الطبقات المحددة في المراجعة الحالية بطبقة مركبة واحدة، ويمكن استعادتها بزر التراجع.
            </p>
          </>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}

function mergePreviewSize(layers: readonly Layer[]) {
  return layers.reduce(
    (size, layer) => ({
      width: Math.max(size.width, (layer.bounds?.x ?? 0) + (layer.bounds?.width ?? 1)),
      height: Math.max(size.height, (layer.bounds?.y ?? 0) + (layer.bounds?.height ?? 1)),
    }),
    { width: 1, height: 1 },
  );
}
