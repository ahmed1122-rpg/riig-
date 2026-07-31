import { useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../shared/Icon";
import type { ProjectMode } from "../../types";

interface DashboardProps {
  onOpenWorkspace: (mode: ProjectMode) => void;
  onNavigateProjects: () => void;
}

export function Dashboard({ onOpenWorkspace, onNavigateProjects }: DashboardProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mode, setMode] = useState<ProjectMode>("image");

  return (
    <div className="dashboard page-enter">
      <section className="dashboard-hero">
        <div className="hero-copy">
          <span className="eyebrow">مسار إنتاج أبسط</span>
          <h1>جهّز ملفك للتحريك،<br />واترك الترتيب علينا.</h1>
          <p>ملف واحد في كل مرة. فصل ذكي، تسمية واضحة، وتصدير جاهز لبيئة Adobe.</p>
          <div className="hero-actions">
            <button className="primary-button primary-button--large" type="button" onClick={() => setWizardOpen(true)}>
              <Icon name="plus" size={19} /> مشروع جديد
            </button>
            <button className="text-button" type="button" onClick={onNavigateProjects}>
              عرض كل المشاريع <Icon name="arrow" size={16} />
            </button>
          </div>
        </div>

        <div className="time-saved" aria-label="حدود عملية التجهيز">
          <span className="time-saved__icon"><Icon name="shieldCheck" size={23} /></span>
          <span>عقد تجهيز واضح</span>
          <strong>30 <small>MB</small></strong>
          <p>ملف واحد لكل عملية · تحقق من النوع والمحتوى</p>
          <div className="time-line"><span style={{ width: "100%" }} /></div>
        </div>
      </section>

      <section className="start-section" aria-labelledby="start-title">
        <div className="section-heading">
          <div>
            <span className="section-index">01</span>
            <h2 id="start-title">ماذا تريد أن تجهّز؟</h2>
          </div>
          <p>اختر المسار، ثم ارفع ملفًا واحدًا بحد أقصى 30 MB.</p>
        </div>

        <div className="creation-paths">
          <button className="creation-path" type="button" onClick={() => onOpenWorkspace("image")}>
            <span className="path-icon path-icon--image"><Icon name="image" size={25} /></span>
            <span className="path-copy">
              <small>للشخصيات، الأشكال والحيوانات</small>
              <strong>تجهيز صورة</strong>
              <p>حتى 15 طبقة بأسماء تبدأ بـ +، مع ملء تلقائي للفراغات.</p>
              <span className="path-output-preview" aria-label="مثال على مخرجات الطبقات">
                <b>مخرج جاهز</b><i dir="rtl">+رأس</i><i dir="rtl">+ذراع_يمين</i><i>≤ 15</i>
              </span>
              <span className="path-meta">PNG · JPG · WEBP <Icon name="arrow" size={16} /></span>
            </span>
          </button>

          <button className="creation-path" type="button" onClick={() => onOpenWorkspace("book")}>
            <span className="path-icon path-icon--pdf"><Icon name="scan" size={25} /></span>
            <span className="path-copy">
              <small>للكتب والصفحات النصية</small>
              <strong>فصل نص PDF</strong>
              <p>خلفية بيضاء ثابتة، والنص طبقات حسب العناوين أو الجمل أو الكلمات.</p>
              <span className="path-output-preview" aria-label="مثال على مخرجات الصفحة">
                <b>مخرج جاهز</b><i dir="ltr">+page_001_background</i><i dir="rtl">+العنوان</i>
              </span>
              <span className="path-meta">PDF <Icon name="arrow" size={16} /></span>
            </span>
          </button>
        </div>
      </section>

      <section className="dashboard-lower">
        <div className="continue-section">
          <div className="section-heading section-heading--compact">
            <div><span className="section-index">02</span><h2>مشاريعك محفوظة في مكان واحد</h2></div>
            <button className="text-button" type="button" onClick={onNavigateProjects}>كل المشاريع</button>
          </div>
          <div className="recent-list">
            <button className="recent-project" type="button" onClick={onNavigateProjects}>
              <span className="recent-thumb recent-thumb--image"><Icon name="folder" size={21} /></span>
              <span className="recent-copy"><strong>افتح مكتبة المشاريع</strong><small>الحالات والمصادر والتصديرات الفعلية من حسابك</small></span>
              <Icon name="chevron" size={17} />
            </button>
          </div>
        </div>

        <aside className="processing-card">
          <div className="processing-head">
            <span><i /> خط الإنتاج</span>
            <small>خادم + عمّال مستقلون</small>
          </div>
          <strong>المصدر → المعالجة → المراجعة → التصدير</strong>
          <p>تظهر حالة كل ملف بعد رفعه، وتبقى المهمة محفوظة عند انقطاع المتصفح.</p>
          <div className="job-progress"><span style={{ width: "100%" }} /></div>
          <div className="processing-foot"><span>قابل للاستئناف</span><span>معرّف تتبع لكل طلب</span></div>
        </aside>
      </section>

      {wizardOpen && createPortal(
        <div className="modal-layer" role="presentation" onMouseDown={() => setWizardOpen(false)}>
          <section className="new-project-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div><span className="eyebrow">ملف واحد، إعداد واحد</span><h2 id="new-project-title">مشروع جديد</h2></div>
              <button className="icon-button" type="button" onClick={() => setWizardOpen(false)} aria-label="إغلاق"><Icon name="close" /></button>
            </header>

            <div className="new-project-dialog__body">
              <ol className="wizard-steps" aria-label="خطوات إنشاء المشروع">
                <li className="is-current"><b>1</b> اختر النوع</li><li><b>2</b> ارفع وجهّز داخل مساحة العمل</li>
              </ol>

              <div className="mode-choice">
                <button className={mode === "image" ? "is-selected" : ""} type="button" onClick={() => setMode("image")}>
                  <Icon name="image" /><span><strong>صورة</strong><small>حتى 15 طبقة</small></span>
                </button>
                <button className={mode === "book" ? "is-selected" : ""} type="button" onClick={() => setMode("book")}>
                  <Icon name="scan" /><span><strong>PDF</strong><small>فصل النص</small></span>
                </button>
              </div>
            </div>

            <footer>
              <span><Icon name="info" size={15} /> سيتم اختيار الملف مرة واحدة داخل مساحة العمل؛ لا توجد خطوة رفع مكررة.</span>
              <button className="primary-button" type="button" onClick={() => { setWizardOpen(false); onOpenWorkspace(mode); }}>
                فتح مساحة العمل <Icon name="arrow" size={17} />
              </button>
            </footer>
          </section>
        </div>,
        document.body,
      )}
    </div>
  );
}
