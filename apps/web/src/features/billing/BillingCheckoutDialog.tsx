import { Dialog } from "../../shared/Dialog";
import { Icon } from "../../shared/Icon";
import type { PaymentProviderAdapter } from "./paymentProviders";

export type CheckoutState =
  | "summary"
  | "redirect"
  | "pending"
  | "delayed"
  | "success"
  | "failure";

export type PlanId = "starter" | "creator" | "studio";

interface BillingPlanView {
  id: PlanId;
  name: string;
  price: number;
}

interface BillingCheckoutDialogProps {
  checkoutState: CheckoutState;
  onClose: () => void;
  onPlanChange: (planId: PlanId) => void;
  onProviderChange: (providerId: PaymentProviderAdapter["id"]) => void;
  onRetry: () => void;
  onStart: () => void;
  open: boolean;
  paymentMode: "disabled" | "sandbox" | "live";
  plan: BillingPlanView;
  plans: BillingPlanView[];
  providerId: PaymentProviderAdapter["id"] | "";
  providers: PaymentProviderAdapter[];
  returnedCheckoutId?: string;
  selectedPlan: PlanId;
}

export function BillingCheckoutDialog({
  checkoutState,
  onClose,
  onPlanChange,
  onProviderChange,
  onRetry,
  onStart,
  open,
  paymentMode,
  plan,
  plans,
  providerId,
  providers,
  returnedCheckoutId,
  selectedPlan,
}: BillingCheckoutDialogProps) {
  if (!open) return null;
  return (
    <Dialog
      title="تأكيد تغيير الخطة"
      description="ستنتقل إلى صفحة دفع مستضافة. لا تُدخل بيانات البطاقة داخل MotionPrep."
      onClose={onClose}
      className="checkout-dialog"
      footer={
        checkoutState === "summary" ? (
          <>
            <button type="button" className="secondary-button" onClick={onClose}>إلغاء</button>
            <button
              type="button"
              className="primary-button"
              onClick={onStart}
              disabled={!providerId || selectedPlan === "starter"}
            >
              المتابعة للدفع المستضاف <Icon name="external" size={15} />
            </button>
          </>
        ) : undefined
      }
    >
      {checkoutState === "summary" && (
        <div className="checkout-summary">
          <span className="sandbox-banner">
            <i /> {paymentMode === "live" ? "معاملة حية" : "معاملة Sandbox"}
          </span>
          <label className="checkout-plan-select">
            الخطة
            <select value={selectedPlan} onChange={(event) => onPlanChange(event.target.value as PlanId)}>
              {plans.filter((item) => item.id !== "starter").map((item) => (
                <option value={item.id} key={item.id}>{item.name} — ${item.price}</option>
              ))}
            </select>
          </label>
          <dl className="checkout-costs">
            <div><dt>الخطة الشهرية</dt><dd>${plan.price.toFixed(2)}</dd></div>
            <div className="checkout-total"><dt>المبلغ الأساسي</dt><dd>${plan.price.toFixed(2)}</dd></div>
          </dl>
          <fieldset className="provider-choice">
            <legend>طريقة الدفع المتاحة</legend>
            {providers.map((provider) => (
              <label
                className={provider.configured ? "" : "is-disabled"}
                key={provider.id}
                title={provider.configured ? provider.description : "غير مهيأ في الخادم"}
              >
                <input
                  type="radio"
                  name="provider"
                  value={provider.id}
                  checked={providerId === provider.id}
                  onChange={() => onProviderChange(provider.id)}
                  disabled={!provider.configured}
                />
                <Icon name={provider.id === "stripe" ? "creditCard" : "wallet"} size={19} />
                <span>
                  <strong>{provider.label}</strong>
                  <small>{provider.configured ? provider.description : "غير متاح في هذه البيئة"}</small>
                </span>
                <em>{provider.mode === "sandbox" ? "Sandbox" : "Live"}</em>
              </label>
            ))}
          </fieldset>
        </div>
      )}

      {(checkoutState === "redirect" || checkoutState === "pending" || checkoutState === "delayed") && (
        <div className="checkout-state" role="status">
          <span className="checkout-loader"><Icon name="external" size={23} /></span>
          <h3>{checkoutState === "redirect" ? "جارٍ إنشاء جلسة الدفع…" : "بانتظار تأكيد مزود الدفع"}</h3>
          <p>لن تتغير الخطة بمجرد العودة؛ Webhook الموقّع هو مصدر الحقيقة.</p>
          {checkoutState === "delayed" && (
            <>
              <p>لم نعرض نجاحًا غير مؤكد. قد يستغرق وصول التأكيد بضع لحظات؛ أعد التحقق بأمان.</p>
              {returnedCheckoutId && (
                <button type="button" className="primary-button" onClick={onRetry}>إعادة التحقق من الدفع</button>
              )}
            </>
          )}
        </div>
      )}

      {(checkoutState === "success" || checkoutState === "failure") && (
        <div className={`checkout-state ${checkoutState === "failure" ? "is-failure" : "is-success"}`} role="status">
          <span><Icon name={checkoutState === "success" ? "badgeCheck" : "warning"} size={28} /></span>
          <h3>{checkoutState === "success" ? "تم تأكيد حالة الدفع" : "لم تكتمل العملية"}</h3>
          <p>{checkoutState === "success" ? "تم تحديث الاشتراك من نتيجة الخادم الموثوقة." : "لم تتغير الخطة. يمكنك المحاولة مجددًا بأمان."}</p>
          <button type="button" className="primary-button" onClick={onClose}>العودة إلى الفوترة</button>
        </div>
      )}
    </Dialog>
  );
}
