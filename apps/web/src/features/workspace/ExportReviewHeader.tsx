import type { ExportFormat } from "@motionprep/contracts";
import type { RefObject } from "react";
import { Icon } from "../../shared/Icon";

interface ExportReviewHeaderProps {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  format: ExportFormat;
  isWorking: boolean;
  onClose: () => void;
}

export function ExportReviewHeader({
  closeButtonRef,
  format,
  isWorking,
  onClose,
}: ExportReviewHeaderProps) {
  const filename =
    format === "psd"
      ? "motionprep.psd"
      : format === "txt" || format === "csv" || format === "json"
        ? `motionprep.${format}`
        : "motionprep.zip";
  return (
    <header className="export-review__header">
      <div className="export-review__title">
        <button ref={closeButtonRef} className="icon-button" type="button" onClick={onClose} disabled={isWorking} aria-label="إغلاق مراجعة التصدير">
          <Icon name="close" size={19} />
        </button>
        <span className="export-proof-mark"><Icon name="packageCheck" size={20} /></span>
        <div>
          <h2 id="export-review-title">المراجعة النهائية</h2>
          <p>عاين الطبقات والأسماء وهدف Adobe قبل إنشاء الملف.</p>
        </div>
      </div>
      <div className="export-review__status">
        <span className="ready-pill"><Icon name="check" size={14} /> جاهز للتصدير</span>
        <span className="review-file-name" dir="ltr">{filename}</span>
      </div>
    </header>
  );
}
