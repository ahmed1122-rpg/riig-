import type { AdminUser } from "../../lib/api";
import { formatDateTime } from "../../shared/formatters";
import type { IconName } from "../../shared/Icon";
import type { AdminView, UserRole } from "../../types";

export const roleLabels: Record<UserRole, string> = {
  creator: "صانع محتوى",
  support: "دعم",
  finance: "مالية",
  admin: "مدير",
};

export const accountStatusLabels: Record<AdminUser["status"], string> = {
  active: "نشط",
  pending_verification: "بانتظار التحقق",
  suspended: "موقوف",
};

export const adminNavigation: Array<{
  id: AdminView;
  label: string;
  icon: IconName;
  roles: UserRole[];
}> = [
  { id: "overview", label: "نظرة عامة", icon: "gauge", roles: ["support", "finance", "admin"] },
  { id: "processing", label: "المعالجة", icon: "activity", roles: ["support", "admin"] },
  { id: "exports", label: "التصديرات", icon: "download", roles: ["support", "admin"] },
  { id: "users", label: "المستخدمون", icon: "users", roles: ["support", "admin"] },
  { id: "billing", label: "الفوترة", icon: "creditCard", roles: ["finance", "admin"] },
  { id: "audit", label: "سجل التدقيق", icon: "history", roles: ["support", "finance", "admin"] },
  { id: "system", label: "التشغيل", icon: "settings", roles: ["admin"] },
];

export function formatAdminDate(value: string | null): string {
  return formatDateTime(value, "لم يسجّل دخوله");
}
