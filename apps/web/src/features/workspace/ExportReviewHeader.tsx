import type { ExportFormat } from "@motionprep/contracts";
import type { RefObject } from "react";
import { Icon } from "../../shared/Icon";
import type { ExportPreflightStatus } from "./exportPreflight";

interface ExportReviewHeaderProps {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  format: ExportFormat;
  isWorking: boolean;
  preflightStatus: ExportPreflightStatus;
  onClose: () => void;
}

export function ExportReviewHeader({
  closeButtonRef,
  format,
  isWorking,
  preflightStatus,
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
        <span className={`ready-pill is-${preflightStatus}`}>
          <Icon name={preflightStatus === "ready" ? "check" : "warning"} size={14} />
          {preflightStatus === "ready"
            ? "جاهز للتصدير"
            : preflightStatus === "warning"
              ? "جاهز مع ملاحظات"
              : "التصدير محجوب"}
        </span>
        <span className="review-file-name" dir="ltr">{filename}</span>
      </div>
    </header>
  );
}
