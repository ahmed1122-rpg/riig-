import { useEffect } from "react";
import { Icon } from "../../shared/Icon";
import type { PdfSegmentation } from "../../types";
import { useWorkspacePreference } from "../workspace/useWorkspacePreference";
import {
  PDF_SEGMENTATION_STORAGE_KEY,
  pdfSegmentationOptions,
} from "../workspace/pdfSegmentation";

interface SettingsViewProps {
  lightTheme: boolean;
  onToggleTheme: () => void;
  onNotify: (message: string) => void;
}

export function SettingsView({
  lightTheme,
  onToggleTheme,
  onNotify,
}: SettingsViewProps) {
  const [pdfSegmentation, setPdfSegmentation] =
    useWorkspacePreference<PdfSegmentation>(
      PDF_SEGMENTATION_STORAGE_KEY,
      "sentences",
    );
  const [previewQuality, setPreviewQuality] =
    useWorkspacePreference<"fast" | "full">(
      "motionprep.settings.preview-quality",
      "fast",
    );
  const [reducedMotion, setReducedMotion] = useWorkspacePreference(
    "motionprep.settings.reduced-motion",
    false,
  );

  useEffect(() => {
    document.documentElement.dataset.motion = reducedMotion
      ? "reduced"
      : "full";
  }, [reducedMotion]);

  const resetWorkspaceLayout = () => {
    try {
      for (const key of [
        "motionprep.workspace.tools-collapsed",
        "motionprep.workspace.layers-collapsed",
        "motionprep.workspace.layers-width",
      ]) {
        window.localStorage.removeItem(key);
      }
      onNotify("أُعيد تخطيط مساحة العمل إلى المقاسات الافتراضية.");
    } catch {
      onNotify("تعذر الوصول إلى التخزين المحلي في هذا المتصفح.");
    }
  };

  return (
    <div className="settings-view page-enter">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">تفضيلات فعلية ومحلية</span>
          <h1>الإعدادات</h1>
          <p>تُطبّق هذه الخيارات على المعاينة ومساحات العمل الجديدة في هذا الجهاز.</p>
        </div>
      </section>

      <div className="settings-grid">
        <section className="settings-card">
          <header><Icon name="sun" size={18} /><div><strong>المظهر</strong><span>السمة والحركة</span></div></header>
          <div className="settings-row">
            <div><strong>السمة</strong><small>فاتحة أو داكنة على مستوى التطبيق</small></div>
            <button className="settings-choice" type="button" onClick={onToggleTheme}>
              <Icon name={lightTheme ? "moon" : "sun"} size={15} />
              {lightTheme ? "استخدام الداكنة" : "استخدام الفاتحة"}
            </button>
          </div>
          <label className="settings-row">
            <div><strong>تقليل الحركة</strong><small>يوقف انتقالات الواجهة غير الضرورية</small></div>
            <input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} />
          </label>
        </section>

        <section className="settings-card">
          <header><Icon name="scanText" size={18} /><div><strong>PDF</strong><span>الإعداد الافتراضي للتحليل</span></div></header>
          <label className="settings-row">
            <div><strong>التقطيع الافتراضي</strong><small>يمكن تغييره لاحقًا وإعادة تحليل المصدر نفسه</small></div>
            <select value={pdfSegmentation} onChange={(event) => setPdfSegmentation(event.target.value as PdfSegmentation)}>
              {pdfSegmentationOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section className="settings-card">
          <header><Icon name="eye" size={18} /><div><strong>المعاينة</strong><span>توازن السرعة والجودة</span></div></header>
          <label className="settings-row">
            <div><strong>الجودة الافتراضية</strong><small>لا تغيّر جودة ملف التصدير النهائي</small></div>
            <select value={previewQuality} onChange={(event) => setPreviewQuality(event.target.value as "fast" | "full")}>
              <option value="fast">سريعة</option>
              <option value="full">كاملة</option>
            </select>
          </label>
          <div className="settings-row">
            <div><strong>تخطيط مساحة العمل</strong><small>الأعمدة وعرض قائمة الطبقات</small></div>
            <button className="settings-choice" type="button" onClick={resetWorkspaceLayout}><Icon name="refresh" size={15} /> إعادة الضبط</button>
          </div>
        </section>
      </div>
    </div>
  );
}
