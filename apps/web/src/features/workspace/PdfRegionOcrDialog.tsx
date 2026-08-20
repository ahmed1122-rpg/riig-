import { useState } from "react";
import { Dialog } from "../../shared/Dialog";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";

interface PdfRegionOcrDialogProps {
  layer: Layer;
  pageSize: { width: number; height: number };
  onClose: () => void;
  onApply: (paddingPercent: number) => Promise<void>;
}

export function PdfRegionOcrDialog({
  layer,
  pageSize,
  onClose,
  onApply,
}: PdfRegionOcrDialogProps) {
  const [paddingPercent, setPaddingPercent] = useState(2);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
      await onApply(paddingPercent);
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر تشغيل OCR على المنطقة المحددة.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title="إعادة OCR للمنطقة"
      description="يعيد العامل قراءة مساحة الطبقة المحددة فقط، ثم يستبدل النص المتقاطع ويحفظ مراجعة يمكن التراجع عنها."
      className="pdf-region-ocr-dialog"
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
            <Icon name="scanText" size={15} />
            {submitting ? "جارٍ تشغيل OCR…" : "تشغيل OCR وحفظ مراجعة"}
          </button>
        </>
      }
    >
      <div className="pdf-region-ocr-summary">
        <p>
          <strong>الطبقة:</strong> {layer.fullText ?? layer.name}
        </p>
        <p>
          <strong>الصفحة:</strong> {layer.pageNumber ?? 1} — {Math.round(pageSize.width)} × {Math.round(pageSize.height)}
        </p>
        <label>
          <span>هامش إضافي حول النص: {paddingPercent}%</span>
          <input
            type="range"
            min={0}
            max={10}
            step={1}
            value={paddingPercent}
            onChange={(event) => setPaddingPercent(Number(event.target.value))}
          />
        </label>
        <small>
          زد الهامش إذا كانت الحروف أو علامات التشكيل قريبة من حدود الطبقة.
        </small>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}
