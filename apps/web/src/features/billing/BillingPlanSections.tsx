import { Icon } from "../../shared/Icon";
import {
  formatBillingPrice,
  type BillingCurrency,
  type PlanId,
} from "./BillingCheckoutDialog";

export interface BillingDisplayPlan {
  id: PlanId;
  name: string;
  note: string;
  price: number;
  credits: string;
  recommended: boolean;
}

export function BillingPlanComparison({
  plans,
  currency,
  currentPlanId,
  onCurrencyChange,
  onChoose,
}: {
  plans: BillingDisplayPlan[];
  currency: BillingCurrency;
  currentPlanId: PlanId | undefined;
  onCurrencyChange: (currency: BillingCurrency) => void;
  onChoose: (planId: PlanId) => void;
}) {
  return (
    <section className="plans-section" aria-labelledby="plans-title">
      <header className="section-heading section-heading--compact">
        <div><span className="section-index">02</span><h2 id="plans-title">قارن الخطط</h2></div>
        <div className="billing-plan-controls">
          <p>الأسعار الشهرية قبل الضرائب التي يحددها المزود عند الحاجة</p>
          <label>
            عملة العرض والدفع
            <select
              value={currency}
              onChange={(event) => onCurrencyChange(event.target.value as BillingCurrency)}
            >
              <option value="USD">USD</option>
              <option value="EGP">EGP</option>
            </select>
          </label>
        </div>
      </header>
      <div className="plan-rows">
        {plans.map((item) => (
          <article
            className={`plan-row ${item.recommended ? "is-recommended" : ""}`}
            key={item.id}
          >
            <div className="plan-name">
              {item.recommended && <span>موصى بها</span>}
              <h3>{item.name}</h3><p>{item.note}</p>
            </div>
            <div className="plan-credit">
              <Icon name="activity" size={17} />
              <span><strong>{item.credits}</strong><small>شهريًا</small></span>
            </div>
            <div className="plan-price">
              <strong>{formatBillingPrice(item.price, currency)}</strong><small>/ شهر</small>
            </div>
            <button
              type="button"
              className={item.id === currentPlanId ? "secondary-button" : "primary-button"}
              disabled={item.id === currentPlanId}
              onClick={() => onChoose(item.id)}
            >
              {item.id === currentPlanId ? "الخطة الحالية" : "اختيار الخطة"}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function BillingInvoices({
  providerCustomerId,
  portalOpening,
  onOpenPortal,
}: {
  providerCustomerId: string | null | undefined;
  portalOpening: boolean;
  onOpenPortal: () => void;
}) {
  return (
    <section className="invoice-section" aria-labelledby="invoice-title">
      <header className="section-heading section-heading--compact">
        <div><span className="section-index">03</span><h2 id="invoice-title">الفواتير</h2></div>
      </header>
      <div className="empty-state">
        <Icon name="fileSearch" size={24} />
        <h3>فواتير المزود المستضافة</h3>
        <p>
          {providerCustomerId
            ? "استخدم بوابة المزود المستضافة لتنزيل الفواتير، تحديث وسيلة الدفع، أو جدولة الإلغاء."
            : "تظهر إدارة الفواتير بعد تفعيل اشتراك حي لدى مزود الدفع؛ لا نعرض بيانات تجريبية كفواتير حقيقية."}
        </p>
        {providerCustomerId && (
          <button
            type="button"
            className="secondary-button"
            disabled={portalOpening}
            onClick={onOpenPortal}
          >
            فتح بوابة الفواتير <Icon name="external" size={14} />
          </button>
        )}
      </div>
    </section>
  );
}
