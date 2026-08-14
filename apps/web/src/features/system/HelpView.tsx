import { Icon } from "../../shared/Icon";
import {
  MAX_IMAGE_LAYERS,
  MAX_IMAGE_UPLOAD_MEBIBYTES,
  MAX_PDF_UPLOAD_MEBIBYTES,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_ITEMS,
} from "@motionprep/contracts";

const steps = [
  ["ارفع ملفًا واحدًا", `صورة حتى ${MAX_IMAGE_UPLOAD_MEBIBYTES} MiB أو PDF حتى ${MAX_PDF_UPLOAD_MEBIBYTES} MiB؛ يتحقق الخادم من النوع والمحتوى.`],
  ["راجع التقطيع", "استخدم الأقلام لإبقاء جزء أو استبعاده أو فصله، وحدد عناوين وأسطر PDF."],
  ["نظّم الطبقات", "الأسماء تبدأ بـ +، ويمكن تعديل الرؤية والقفل والترتيب قبل التصدير."],
  ["صدّر إلى Adobe", "للصور: PSD وPNG وTIFF. ولـPDF: PSD وPNG+JSON وTXT/CSV/JSON."],
] as const;

export function HelpView() {
  return (
    <div className="help-view page-enter">
      <section className="page-title-row">
        <div>
          <span className="eyebrow">دليل إنتاج مختصر</span>
          <h1>المساعدة</h1>
          <p>المسار الكامل من المصدر إلى ملف جاهز للتحريك، دون خطوات متكررة.</p>
        </div>
      </section>
      <section className="help-atlas" aria-labelledby="help-atlas-title">
        <div className="help-atlas__copy">
          <span className="eyebrow">من الرسم إلى أوضاع قابلة للتحريك</span>
          <h2 id="help-atlas-title">ابدأ بالطبقات التي تخدم اللقطة.</h2>
          <p>
            لا تحتاج إلى فصل كل تفصيلة. حدّد الحركة المطلوبة، راجع الحواف
            والتسمية، ثم احتفظ بإصدار يمكنك الرجوع إليه قبل التصدير.
          </p>
          <div className="help-atlas__tags" aria-label="نقاط المراجعة">
            <span><Icon name="layers" size={15} /> تسمية واضحة</span>
            <span><Icon name="review" size={15} /> مراجعة بصرية</span>
            <span><Icon name="history" size={15} /> إصدار محفوظ</span>
          </div>
        </div>
        <img
          src="/visuals/presenter-poses.webp"
          width="1024"
          height="1024"
          alt="مجموعة أوضاع لشخصية ثلاثية الأبعاد توضح الاستعداد للحركة"
          loading="eager"
          decoding="async"
        />
      </section>
      <ol className="help-steps">
        {steps.map(([title, description], index) => (
          <li key={title}>
            <b>{String(index + 1).padStart(2, "0")}</b>
            <span><strong>{title}</strong><small>{description}</small></span>
          </li>
        ))}
      </ol>
      <section className="help-limits">
        <article><Icon name="image" size={18} /><strong>الصور</strong><span>{MAX_IMAGE_LAYERS} طبقة كحد أقصى، والفائض يُجمع في طبقة مراجعة.</span></article>
        <article><Icon name="scanText" size={18} /><strong>PDF</strong><span>لا حد ثابت لطبقات النص؛ حتى {MAX_PDF_UPLOAD_MEBIBYTES} MiB و{MAX_PDF_PAGES} صفحة و{MAX_PDF_TEXT_ITEMS.toLocaleString("en-US")} عنصر نصي.</span></article>
        <article><Icon name="shieldCheck" size={18} /><strong>الحفظ</strong><span>الإصدارات والوظائف محفوظة على الخادم ويمكن فتحها من المشاريع.</span></article>
      </section>
    </div>
  );
}
