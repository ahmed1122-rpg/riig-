import { Icon } from "../../shared/Icon";
import type { ProjectMode } from "../../types";
import type { ExportPreflightResult } from "./exportPreflight";
import { uploadLimitLabel } from "./uploadLimit";

export function ExportQualitySummary({
  mode,
  maxUploadBytes,
  preflight,
}: {
  mode: ProjectMode;
  maxUploadBytes: number;
  preflight: ExportPreflightResult;
}) {
  return (
    <section className="quality-summary">
      <div className="quality-summary__heading">
        <span><Icon name="packageCheck" size={18} /></span>
        <div><strong>فحص ما قبل التصدير</strong><small>يعيد الخادم التحقق من الوثيقة قبل الإنشاء</small></div>
      </div>
      <ul>
        {preflight.findings.length === 0 ? (
          <li className="is-ok"><Icon name="check" size={14} /><span>الـgraph والأسماء وحالة الحفظ مطابقة لعقد الإنتاج.</span></li>
        ) : preflight.findings.map((finding) => (
          <li key={finding.key} className={finding.severity === "blocked" ? "is-blocker" : "is-warning"}>
            <Icon name="warning" size={14} /><span>{finding.message}</span>
          </li>
        ))}
        {mode === "book" && (
          <li className="is-unlimited"><Icon name="info" size={14} /><span>حد المصدر {uploadLimitLabel(maxUploadBytes)} · لا يوجد حد ثابت لعدد طبقات PDF</span></li>
        )}
        <li className="is-ok"><Icon name="check" size={14} /><span>يظل المصدر الأصلي دون تغيير؛ تُضغط مخرجات PNG وTIFF والأرشيفات بلا فقدان أثناء التصدير.</span></li>
        <li className="is-warning"><Icon name="warning" size={14} /><span>{mode === "image" ? "PSD حقيقي، لكن ادعاء توافق Adobe الكامل مؤجل لاختبارات Golden" : "PSD فعلي بطبقات Raster؛ النصوص قابلة للتحريك كطبقات وليست قابلة للتحرير كنص داخل Photoshop"}</span></li>
      </ul>
    </section>
  );
}
