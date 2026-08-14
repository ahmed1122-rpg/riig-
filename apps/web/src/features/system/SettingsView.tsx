import { useEffect, useState } from "react";
import { Icon } from "../../shared/Icon";
import { downloadBlob } from "../../shared/browserDownload";
import { deleteAccount, exportAccountData } from "../../lib/api";
import type { PdfSegmentation } from "../../types";
import { useWorkspacePreference } from "../workspace/useWorkspacePreference";
import {
  PDF_SEGMENTATION_STORAGE_KEY,
  isPdfSegmentation,
  pdfSegmentationOptions,
} from "../workspace/pdfSegmentation";

interface SettingsViewProps {
  authenticated: boolean;
  lightTheme: boolean;
  onToggleTheme: () => void;
  onRequireAuth: () => void;
  onNotify: (message: string) => void;
  onSessionEnded: () => void;
}

export function SettingsView({
  authenticated,
  lightTheme,
  onToggleTheme,
  onRequireAuth,
  onNotify,
  onSessionEnded,
}: SettingsViewProps) {
  const [accountAction, setAccountAction] = useState<"idle" | "exporting" | "deleting">("idle");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [pdfSegmentation, setPdfSegmentation] =
    useWorkspacePreference<PdfSegmentation>(
      PDF_SEGMENTATION_STORAGE_KEY,
      "sentences",
      isPdfSegmentation,
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

  const downloadAccountData = async () => {
    setAccountAction("exporting");
    try {
      const data = await exportAccountData();
      downloadBlob([JSON.stringify(data, null, 2)], {
        filename: `motionprep-account-${data.generatedAt.slice(0, 10)}.json`,
        type: "application/json",
      });
      onNotify("تم إعداد نسخة بيانات الحساب وتنزيلها.");
    } catch {
      onNotify("تعذر تصدير بيانات الحساب الآن.");
    } finally {
      setAccountAction("idle");
    }
  };

  const requestAccountDeletion = async () => {
    if (!deleteConfirmed || !deletePassword) return;
    setAccountAction("deleting");
    try {
      const result = await deleteAccount(deletePassword);
      onNotify(
        result.status === "completed"
          ? "حُذف الحساب والملفات الخاصة به."
          : "سُجل طلب الحذف وسيُستكمل تلقائيًا بأمان.",
      );
      onSessionEnded();
    } catch {
      onNotify("تعذر طلب الحذف. تحقق من كلمة المرور والاشتراك النشط.");
      setAccountAction("idle");
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
          <header><Icon name="eye" size={18} /><div><strong>المعاينة</strong><span>إعدادات العرض ومساحة العمل</span></div></header>
          <div className="settings-row">
            <div><strong>تخطيط مساحة العمل</strong><small>الأعمدة وعرض قائمة الطبقات</small></div>
            <button className="settings-choice" type="button" onClick={resetWorkspaceLayout}><Icon name="refresh" size={15} /> إعادة الضبط</button>
          </div>
        </section>

        <section className="settings-card">
          <header><Icon name="shield" size={18} /><div><strong>الخصوصية والحساب</strong><span>نسخة البيانات والحذف الدائم</span></div></header>
          {authenticated ? (
            <>
              <div className="settings-row">
                <div><strong>تصدير بياناتي</strong><small>ملف JSON يتضمن بيانات الحساب والمشاريع وسجل العمليات دون أسرار أو مفاتيح تخزين.</small></div>
                <button className="settings-choice" type="button" disabled={accountAction !== "idle"} onClick={() => void downloadAccountData()}>
                  <Icon name="download" size={15} /> {accountAction === "exporting" ? "جارٍ التجهيز…" : "تنزيل النسخة"}
                </button>
              </div>
              <div className="settings-row settings-row--danger">
                <div><strong>حذف الحساب</strong><small>يحذف المشاريع والملفات، ويُبقي سجلات التدقيق والفوترة مجهولة الهوية. ألغِ أي اشتراك مدفوع أولًا.</small></div>
                <div className="settings-account-delete">
                  <input type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} placeholder="كلمة المرور الحالية" />
                  <label><input type="checkbox" checked={deleteConfirmed} onChange={(event) => setDeleteConfirmed(event.target.checked)} /> أفهم أن الحذف غير قابل للتراجع</label>
                  <button className="settings-choice" type="button" disabled={!deleteConfirmed || !deletePassword || accountAction !== "idle"} onClick={() => void requestAccountDeletion()}>
                    {accountAction === "deleting" ? "جارٍ الحذف…" : "حذف الحساب نهائيًا"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="settings-row">
              <div><strong>بيانات الحساب</strong><small>سجّل الدخول لتنزيل بياناتك أو إدارة حذف الحساب.</small></div>
              <button className="settings-choice" type="button" onClick={onRequireAuth}>تسجيل الدخول</button>
            </div>
          )}
          <p><a href="/legal/privacy.html" target="_blank" rel="noreferrer">سياسة الخصوصية</a>{" · "}<a href="/legal/terms.html" target="_blank" rel="noreferrer">شروط الاستخدام</a></p>
        </section>
      </div>
    </div>
  );
}
