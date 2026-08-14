import type { Layer } from "../../types";

export function layerReorderIssue(
  source: Pick<Layer, "pageNumber" | "parentId">,
  target: Pick<Layer, "pageNumber" | "parentId">,
): string | undefined {
  if ((source.pageNumber ?? 1) !== (target.pageNumber ?? 1)) {
    return "لا يمكن نقل طبقة بين صفحات PDF بالسحب. انقل المحتوى بأداة مخصصة تحفظ ملكية الصفحة.";
  }
  if ((source.parentId ?? null) !== (target.parentId ?? null)) {
    return "لا يمكن نقل طبقة خارج مجلدها بالسحب. اختر هدفًا داخل المجلد نفسه.";
  }
  return undefined;
}
