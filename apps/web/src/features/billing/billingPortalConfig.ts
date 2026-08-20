import type { PlanId } from "./BillingCheckoutDialog";

export interface BillingPortalProps {
  authenticated: boolean;
  onRequireAuth: () => void;
  onNotify: (message: string) => void;
}

export const planPresentation: Array<{
  id: PlanId;
  name: string;
  note: string;
}> = [
  { id: "starter", name: "بداية", note: "للتجربة والمشروعات الخفيفة" },
  { id: "creator", name: "صانع محتوى", note: "للإنتاج الأسبوعي المنتظم" },
  { id: "studio", name: "استوديو", note: "للإنتاج المكثف والفرق الصغيرة" },
];
