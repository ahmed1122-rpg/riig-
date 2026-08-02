import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";

import { Icon } from "../../shared/Icon";
import type { ProjectMode } from "../../types";
import { uploadLimitLabel } from "./uploadLimit";

export function ExportQualitySummary({
  mode,
  imageLayerCount,
  maxUploadBytes,
}: {
  mode: ProjectMode;
  imageLayerCount: number;
  maxUploadBytes: number;
}) {
  return (
    <section className="quality-summary">
      <div className="quality-summary__heading">
        <span><Icon name="packageCheck" size={18} /></span>
        <div><strong>فحص ما قبل التصدير</strong><small>يعيد الخادم التحقق من الوثيقة قبل الإنشاء</small></div>
      </div>
      <ul>
        <li className="is-ok"><Icon name="check" size={14} /><span>أسماء الطبقات تبدأ بـ + واحدة</span></li>
        {mode === "image" ? (
          <li className={imageLayerCount <= MAX_IMAGE_LAYERS ? "is-ok" : "is-blocker"}><Icon name={imageLayerCount <= MAX_IMAGE_LAYERS ? "check" : "warning"} size={14} /><span>{imageLayerCount} / {MAX_IMAGE_LAYERS} طبقة للصور</span></li>
        ) : (
          <>
            <li className="is-ok"><Icon name="check" size={14} /><span>الخلفية البيضاء الثابتة مطلوبة لكل صفحة</span></li>
            <li className="is-unlimited"><Icon name="info" size={14} /><span>حد المصدر {uploadLimitLabel(maxUploadBytes)} · لا يوجد حد ثابت لعدد طبقات PDF</span></li>
          </>
        )}
        <li className="is-warning"><Icon name="warning" size={14} /><span>{mode === "image" ? "PSD حقيقي، لكن ادعاء توافق Adobe الكامل مؤجل لاختبارات Golden" : "PSD فعلي بطبقات Raster؛ النصوص قابلة للتحريك كطبقات وليست قابلة للتحرير كنص داخل Photoshop"}</span></li>
      </ul>
    </section>
  );
}
