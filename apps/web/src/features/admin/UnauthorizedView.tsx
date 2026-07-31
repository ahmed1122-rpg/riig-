import { Icon } from "../../shared/Icon";
import type { UserRole } from "../../types";

export default function UnauthorizedView({ role, onReturn }: { role: UserRole; onReturn: () => void }) {
  return (
    <main className="unauthorized-page" dir="rtl">
      <section>
        <span className="unauthorized-icon"><Icon name="shield" size={30} /></span>
        <span className="eyebrow">403 / مسار محمي</span>
        <h1>لا يملك هذا الدور صلاحية الوصول</h1>
        <p>أنت الآن في دور <strong>{role === "creator" ? "صانع محتوى" : role}</strong>. إخفاء التنقل يحسن التجربة، لكن الخادم يبقى المرجع النهائي لكل صلاحية.</p>
        <div><button type="button" className="primary-button" onClick={onReturn}>العودة إلى الاستوديو</button></div>
        <small><Icon name="info" size={14} /> تُفرض الصلاحية في الخادم، ولا يمكن تغيير الدور من هذه الواجهة.</small>
      </section>
    </main>
  );
}
