import type { WorkflowActivityItem } from "@motionprep/contracts";

const integrityFailureCodes = new Set([
  "SOURCE_INTEGRITY_FAILED",
  "UPLOAD_INTEGRITY_FAILED",
  "EXPORT_SOURCE_INTEGRITY_FAILED",
  "EXPORT_ARTIFACT_INTEGRITY_FAILED",
  "STORAGE_UNAVAILABLE",
]);

const revisionFailureCodes = new Set([
  "SOURCE_NOT_CURRENT",
  "DOCUMENT_REVISION_CONFLICT",
  "EXPORT_DOCUMENT_REVISION_CONFLICT",
  "EXPORT_SOURCE_NOT_CURRENT",
]);

const exportReviewFailureCodes = new Set([
  "EXPORT_DOCUMENT_NOT_READY",
  "EXPORT_PREFLIGHT_FAILED",
  "EXPORT_SOURCE_NOT_READY",
  "REVIEW_APPROVAL_REQUIRED",
]);

const unsupportedExportFailureCodes = new Set([
  "EXPORT_FORMAT_UNSUPPORTED",
  "EXPORT_OPTION_UNSUPPORTED",
  "EXPORT_SCOPE_UNSUPPORTED",
]);

const ocrFailureCodes = new Set(["OCR_FAILED", "OCR_REQUIRED"]);

export function getExportFailureMessage(errorCode: string | null): string {
  if (!errorCode) {
    return "توقفت محاولة التصدير قبل اكتمالها.";
  }
  if (revisionFailureCodes.has(errorCode)) {
    return "تغيّر المشروع بعد بدء المحاولة؛ افتحه وراجع أحدث نسخة ثم صدّر من جديد.";
  }
  if (exportReviewFailureCodes.has(errorCode)) {
    return "يحتاج المشروع إلى مراجعة أو تجهيز إضافي قبل إنشاء ملف جديد.";
  }
  if (integrityFailureCodes.has(errorCode)) {
    return "تعذر التحقق من المصدر أو حفظ الملف الناتج بأمان.";
  }
  if (unsupportedExportFailureCodes.has(errorCode)) {
    return "إعداد التصدير المستخدم غير متاح لهذا المشروع.";
  }
  return "تعذر إكمال محاولة التصدير. افتح المشروع وأنشئ محاولة جديدة.";
}

export function getActivityFailureMessage(
  item: Pick<WorkflowActivityItem, "kind" | "errorCode">,
): string {
  if (item.errorCode && integrityFailureCodes.has(item.errorCode)) {
    return "تعذر التحقق من سلامة المصدر أو الملف الناتج.";
  }
  if (item.errorCode && revisionFailureCodes.has(item.errorCode)) {
    return "تغيّر المشروع أثناء العملية؛ افتح أحدث نسخة قبل المتابعة.";
  }
  if (item.errorCode && ocrFailureCodes.has(item.errorCode)) {
    return "تحتاج قراءة النص إلى مراجعة داخل المشروع.";
  }
  if (item.kind === "upload") {
    return "لم يكتمل رفع المصدر أو التحقق منه.";
  }
  if (item.kind === "processing") {
    return "توقفت معالجة المصدر قبل اكتمالها.";
  }
  if (item.kind === "export") {
    return "لم تكتمل محاولة التصدير؛ افتح المشروع لإنشاء محاولة جديدة.";
  }
  return "تحتاج هذه الخطوة إلى تدخل داخل المشروع.";
}
