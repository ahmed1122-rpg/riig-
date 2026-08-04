import type {
  WorkflowActivityKind,
  WorkflowActivityStatus,
} from "@motionprep/contracts";
import type { IconName } from "../../shared/Icon";

export const activityKindPresentation: Record<
  WorkflowActivityKind,
  { label: string; icon: IconName }
> = {
  upload: { label: "رفع المصدر", icon: "upload" },
  processing: { label: "المعالجة", icon: "activity" },
  review: { label: "المراجعة", icon: "review" },
  export: { label: "التصدير", icon: "packageCheck" },
};

export const activityStatusLabels: Record<WorkflowActivityStatus, string> = {
  pending: "في الانتظار",
  running: "قيد التنفيذ",
  attention: "يحتاج مراجعتك",
  succeeded: "مكتمل",
  failed: "فشل",
  cancelled: "ملغى",
};

export const activityActionLabels = {
  "open-project": "فتح المشروع",
  "review-project": "بدء المراجعة",
  "view-exports": "عرض التصدير",
} as const;
