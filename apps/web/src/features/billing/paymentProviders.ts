export interface PaymentProviderAdapter {
  id: "sandbox-card" | "sandbox-local" | "stripe";
  label: string;
  description: string;
  configured: boolean;
  mode: "sandbox" | "live";
  checkoutKind: "hosted";
}

/**
 * واجهة العرض لا تعرف أي مفاتيح أو منطق خاص بمزود بعينه.
 * يحدد الخادم المزودات المهيأة ويعيد رابط الدفع المستضاف عند الربط الفعلي.
 */
const paymentProviderCatalog: PaymentProviderAdapter[] = [
  {
    id: "stripe",
    label: "Stripe Checkout",
    description: "اشتراك دولي عبر صفحة Stripe المستضافة.",
    configured: false,
    mode: "live",
    checkoutKind: "hosted",
  },
  {
    id: "sandbox-card",
    label: "بطاقة تجريبية",
    description: "اختبار دورة الدفع دون تحصيل فعلي.",
    configured: false,
    mode: "sandbox",
    checkoutKind: "hosted",
  },
  {
    id: "sandbox-local",
    label: "دفع محلي تجريبي",
    description: "محاكاة وسيلة دفع محلية داخل بيئة الاختبار.",
    configured: false,
    mode: "sandbox",
    checkoutKind: "hosted",
  },
];

export function configuredPaymentProviders(
  configuredIds: readonly PaymentProviderAdapter["id"][],
): PaymentProviderAdapter[] {
  const configured = new Set(configuredIds);
  return paymentProviderCatalog.map((provider) => ({
    ...provider,
    configured: configured.has(provider.id),
  }));
}
