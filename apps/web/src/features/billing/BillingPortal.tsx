import { useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  completeSandboxCheckout,
  createBillingPortal,
  createHostedCheckout,
  getBillingConfiguration,
  getCheckout,
  getSubscription,
  type BillingConfiguration,
  type SubscriptionSummary,
} from "../../lib/api";
import { Icon } from "../../shared/Icon";
import {
  configuredPaymentProviders,
  type PaymentProviderAdapter,
} from "./paymentProviders";
import { BILLING_PLAN_CATALOG } from "@motionprep/contracts";
import { waitForCheckoutResolution } from "./checkoutReturn";
import {
  BillingCheckoutDialog,
  type CheckoutState,
  type PlanId,
} from "./BillingCheckoutDialog";

interface BillingPortalProps {
  authenticated: boolean;
  onRequireAuth: () => void;
  onNotify: (message: string) => void;
}

const planPresentation: Array<{
  id: PlanId;
  name: string;
  note: string;
}> = [
  {
    id: "starter",
    name: "بداية",
    note: "للتجربة والمشروعات الخفيفة",
  },
  {
    id: "creator",
    name: "صانع محتوى",
    note: "للإنتاج الأسبوعي المنتظم",
  },
  {
    id: "studio",
    name: "استوديو",
    note: "للإنتاج المكثف والفرق الصغيرة",
  },
];

export default function BillingPortal({
  authenticated,
  onRequireAuth,
  onNotify,
}: BillingPortalProps) {
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutState, setCheckoutState] =
    useState<CheckoutState>("summary");
  const [selectedPlan, setSelectedPlan] = useState<PlanId>("creator");
  const [providerId, setProviderId] =
    useState<PaymentProviderAdapter["id"] | "">("");
  const [configuration, setConfiguration] =
    useState<BillingConfiguration | null>(null);
  const [subscription, setSubscription] =
    useState<SubscriptionSummary | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [portalOpening, setPortalOpening] = useState(false);
  const [returnedCheckoutId, setReturnedCheckoutId] = useState<string>();
  const handledReturnRef = useRef<string | undefined>(undefined);

  const providers = useMemo(
    () => configuredPaymentProviders(configuration?.providers ?? []),
    [configuration],
  );
  const plans = useMemo(() => {
    const catalog = configuration?.plans ?? BILLING_PLAN_CATALOG;
    return planPresentation.map((presentation) => {
      const item = catalog.find(
        (candidate) => candidate.id === presentation.id,
      )!;
      return {
        ...presentation,
        price: item.prices.USD / 100,
        credits: `${new Intl.NumberFormat("ar-EG").format(item.processingMinuteLimit)} دقيقة معالجة`,
        recommended: item.recommended,
      };
    });
  }, [configuration]);
  const plan =
    plans.find((item) => item.id === selectedPlan) ?? plans[1]!;
  const currentPlan =
    plans.find((item) => item.id === subscription?.planId) ?? plans[0]!;
  const usagePercent = subscription
    ? Math.min(
        100,
        (subscription.usage.processingMinutes /
          Math.max(1, subscription.usage.processingMinuteLimit)) *
          100,
      )
    : 0;
  const paymentMode = configuration?.mode ?? "disabled";

  const refreshBilling = async () => {
    const [nextConfiguration, nextSubscription] = await Promise.all([
      getBillingConfiguration(),
      getSubscription(),
    ]);
    setConfiguration(nextConfiguration);
    setSubscription(nextSubscription);
    const firstConfigured = configuredPaymentProviders(
      nextConfiguration.providers,
    ).find((provider) => provider.configured);
    setProviderId((current) => current || firstConfigured?.id || "");
  };

  useEffect(() => {
    if (!authenticated) return;
    void refreshBilling().catch((error) => {
      if (error instanceof ApiError && error.status === 401) {
        onRequireAuth();
        return;
      }
      setPageError(
        error instanceof Error ? error.message : "تعذر تحميل بيانات الفوترة.",
      );
    });
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    const query = new URLSearchParams(window.location.search);
    const sandboxCheckout = query.get("sandbox_checkout");
    const paymentResult = query.get("payment");
    if (!sandboxCheckout && !paymentResult) return;

    const checkoutId = sandboxCheckout ?? query.get("checkout_id");
    const returnKey = `${sandboxCheckout ?? ""}:${paymentResult ?? ""}:${checkoutId ?? ""}`;
    if (handledReturnRef.current === returnKey) return;
    handledReturnRef.current = returnKey;
    const controller = new AbortController();
    let finished = false;

    setCheckoutOpen(true);
    setCheckoutState("pending");
    setReturnedCheckoutId(checkoutId ?? undefined);
    const finalize = async () => {
      if (paymentResult === "cancelled") {
        await refreshBilling();
        if (!controller.signal.aborted) setCheckoutState("failure");
        return;
      }
      if (!checkoutId) {
        await refreshBilling();
        if (!controller.signal.aborted) setCheckoutState("delayed");
        return;
      }
      if (sandboxCheckout) await completeSandboxCheckout(sandboxCheckout);
      const resolution = await waitForCheckoutResolution(checkoutId, {
        getCheckout,
        signal: controller.signal,
      });
      await refreshBilling();
      if (!controller.signal.aborted) setCheckoutState(resolution);
    };
    const cleanReturnUrl = () => {
      query.delete("sandbox_checkout");
      query.delete("provider");
      query.delete("payment");
      query.delete("checkout_id");
      query.delete("session_id");
      query.delete("billingReturn");
      const suffix = query.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${suffix ? `?${suffix}` : ""}`,
      );
    };
    void finalize()
      .catch(() => {
        if (!controller.signal.aborted) setCheckoutState("failure");
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        cleanReturnUrl();
        finished = true;
      });

    return () => {
      controller.abort();
      if (!finished && handledReturnRef.current === returnKey) {
        handledReturnRef.current = undefined;
      }
    };
  }, [authenticated]);

  const retryCheckoutVerification = async () => {
    if (!returnedCheckoutId) return;
    setCheckoutState("pending");
    setPageError(null);
    try {
      const resolution = await waitForCheckoutResolution(
        returnedCheckoutId,
        { getCheckout },
      );
      await refreshBilling();
      setCheckoutState(resolution);
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : "تعذر التحقق من جلسة الدفع.",
      );
      setCheckoutState("failure");
    }
  };

  const openCheckout = (planId: PlanId) => {
    if (!authenticated) {
      onRequireAuth();
      return;
    }
    if (planId === "starter") {
      onNotify("الخطة المجانية لا تحتاج إلى جلسة دفع.");
      return;
    }
    setSelectedPlan(planId);
    setCheckoutState("summary");
    setCheckoutOpen(true);
  };

  const startHostedCheckout = async () => {
    if (!providerId || selectedPlan === "starter") return;
    setCheckoutState("redirect");
    try {
      const returnUrl = new URL(window.location.href);
      returnUrl.search = "";
      returnUrl.searchParams.set("billingReturn", "1");
      const checkout = await createHostedCheckout({
        providerId,
        planId: selectedPlan,
        currency: "USD",
        returnUrl: returnUrl.toString(),
      });
      if (!checkout.checkoutUrl) throw new Error("لم يُرجع المزود رابط دفع.");
      window.location.assign(checkout.checkoutUrl);
    } catch (error) {
      setPageError(
        error instanceof Error ? error.message : "تعذر إنشاء جلسة الدفع.",
      );
      setCheckoutState("failure");
    }
  };

  const openCustomerPortal = async () => {
    setPortalOpening(true);
    setPageError(null);
    try {
      const returnUrl = new URL(window.location.href);
      returnUrl.search = "";
      returnUrl.searchParams.set("billingReturn", "1");
      const portal = await createBillingPortal(returnUrl.toString());
      window.location.assign(portal.portalUrl);
    } catch (error) {
      setPageError(
        error instanceof Error
          ? error.message
          : "تعذر فتح بوابة إدارة الاشتراك.",
      );
      setPortalOpening(false);
    }
  };

  if (!authenticated) {
    return (
      <section className="billing-page page-enter">
        <div className="data-state billing-auth-state">
          <Icon name="shield" size={30} />
          <h2>سجّل الدخول لعرض الفوترة</h2>
          <p>الاشتراك والاستخدام مرتبطان بحسابك ولا يُعرضان في وضع مجهول.</p>
          <button className="primary-button" type="button" onClick={onRequireAuth}>
            تسجيل الدخول
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="billing-page page-enter">
      <header className="feature-page-header billing-heading">
        <div>
          <span className="eyebrow">الفوترة والاستخدام</span>
          <h1>خطتك تعمل مع إيقاع إنتاجك</h1>
          <p>
            راقب الدقائق والتجديد من مكان واحد، وانتقل إلى صفحة مزود مستضافة
            عند الدفع.
          </p>
        </div>
        <span className="sandbox-banner">
          <i />{" "}
          {paymentMode === "live"
            ? "LIVE — STRIPE WEBHOOK VERIFIED"
            : paymentMode === "sandbox"
              ? "SANDBOX — لا يوجد تحصيل فعلي"
              : "PAYMENTS DISABLED"}
        </span>
      </header>

      {pageError && (
        <div className="form-message is-error" role="alert">
          {pageError}
        </div>
      )}

      <div className="billing-overview">
        <article className="current-plan">
          <div className="current-plan__title">
            <span><Icon name="badgeCheck" size={22} /></span>
            <div><small>الخطة الحالية</small><h2>{currentPlan.name}</h2></div>
            <em>
              {subscription?.status === "active"
                ? subscription.cancelAtPeriodEnd
                  ? "تنتهي بنهاية الدورة"
                  : "نشطة"
                : subscription?.status === "trialing"
                  ? "فترة تجريبية"
                  : subscription?.status === "past_due"
                    ? "الدفع متعثر"
                    : subscription?.status === "cancelled"
                      ? "ملغاة"
                      : "قيد المراجعة"}
            </em>
          </div>
          <p>
            التجديد في{" "}
            <strong>
              {subscription
                ? new Intl.DateTimeFormat("ar-EG", { dateStyle: "medium" }).format(
                    new Date(subscription.renewalAt),
                  )
                : "—"}
            </strong>
          </p>
          <div className="usage-line">
            <div>
              <span>دقائق المعالجة</span>
              <strong>
                {subscription?.usage.processingMinutes ?? 0} /{" "}
                {subscription?.usage.processingMinuteLimit ?? 0}
              </strong>
            </div>
            <div className="usage-bar">
              <i style={{ width: `${usagePercent}%` }} />
            </div>
            <small>
              الاستخدام يُحسب من المهام المكتملة داخل دورة الاشتراك الحالية.
            </small>
          </div>
          <div className="usage-split">
            <span><Icon name="activity" size={16} /><b>{subscription?.usage.jobs ?? 0}</b><small>مهمة مستخدمة</small></span>
            <span><Icon name="layers" size={16} /><b>{subscription?.usage.jobLimit ?? 0}</b><small>حد المهام</small></span>
            <span><Icon name="shield" size={16} /><b>Hosted</b><small>بيانات البطاقة خارج التطبيق</small></span>
          </div>
        </article>

        <aside className="billing-method">
          <header>
            <span><Icon name="creditCard" size={19} /></span>
            <div><strong>بوابة الدفع</strong><small>تهيئة الخادم هي مصدر الحقيقة</small></div>
          </header>
          <div className="payment-card-demo">
            <span>المزود النشط</span>
            <bdi>{providers.find((provider) => provider.configured)?.label ?? "غير مهيأ"}</bdi>
            <small>{paymentMode === "live" ? "Webhook موقّع" : "بيئة اختبار"}</small>
          </div>
          <button
            type="button"
            className="secondary-button full-button"
            disabled={!providers.some((provider) => provider.configured)}
            onClick={() => {
              setCheckoutState("summary");
              setCheckoutOpen(true);
            }}
          >
            تغيير الخطة <Icon name="external" size={15} />
          </button>
          {subscription?.providerCustomerId && (
            <button
              type="button"
              className="secondary-button full-button"
              disabled={portalOpening}
              onClick={() => void openCustomerPortal()}
            >
              {portalOpening ? "جارٍ فتح البوابة…" : "إدارة الاشتراك والفواتير"}{" "}
              <Icon name="external" size={15} />
            </button>
          )}
          <p><Icon name="shield" size={13} /> لا تستقبل MotionPrep أرقام البطاقات الخام.</p>
        </aside>
      </div>

      <section className="plans-section" aria-labelledby="plans-title">
        <header className="section-heading section-heading--compact">
          <div><span className="section-index">02</span><h2 id="plans-title">قارن الخطط</h2></div>
          <p>الأسعار الشهرية قبل الضرائب التي يحددها المزود عند الحاجة</p>
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
                <strong>${item.price}</strong><small>/ شهر</small>
              </div>
              <button
                type="button"
                className={
                  item.id === subscription?.planId
                    ? "secondary-button"
                    : "primary-button"
                }
                disabled={item.id === subscription?.planId}
                onClick={() => openCheckout(item.id)}
              >
                {item.id === subscription?.planId ? "الخطة الحالية" : "اختيار الخطة"}
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="invoice-section" aria-labelledby="invoice-title">
        <header className="section-heading section-heading--compact">
          <div><span className="section-index">03</span><h2 id="invoice-title">الفواتير</h2></div>
        </header>
        <div className="empty-state">
          <Icon name="fileSearch" size={24} />
          <h3>فواتير المزود المستضافة</h3>
          <p>
            {subscription?.providerCustomerId
              ? "استخدم بوابة المزود المستضافة لتنزيل الفواتير، تحديث وسيلة الدفع، أو جدولة الإلغاء."
              : "تظهر إدارة الفواتير بعد تفعيل اشتراك حي لدى مزود الدفع؛ لا نعرض بيانات تجريبية كفواتير حقيقية."}
          </p>
          {subscription?.providerCustomerId && (
            <button
              type="button"
              className="secondary-button"
              disabled={portalOpening}
              onClick={() => void openCustomerPortal()}
            >
              فتح بوابة الفواتير <Icon name="external" size={14} />
            </button>
          )}
        </div>
      </section>

      <BillingCheckoutDialog
        checkoutState={checkoutState}
        onClose={() => setCheckoutOpen(false)}
        onPlanChange={setSelectedPlan}
        onProviderChange={setProviderId}
        onRetry={() => void retryCheckoutVerification()}
        onStart={() => void startHostedCheckout()}
        open={checkoutOpen}
        paymentMode={paymentMode}
        plan={plan}
        plans={plans}
        providerId={providerId}
        providers={providers}
        {...(returnedCheckoutId ? { returnedCheckoutId } : {})}
        selectedPlan={selectedPlan}
      />
    </section>
  );
}
