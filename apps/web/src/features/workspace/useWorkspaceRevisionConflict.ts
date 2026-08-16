import { useCallback } from "react";
import type { useConfirmation } from "../../shared/useConfirmation";
import { isWorkspaceRevisionConflict } from "./workspaceConflict";

export function useWorkspaceRevisionConflict(
  requestConfirmation: ReturnType<typeof useConfirmation>["requestConfirmation"],
  onNotify: (message: string) => void,
) {
  return useCallback(
    async (error: unknown): Promise<void> => {
      if (!isWorkspaceRevisionConflict(error)) return;
      const reload = await requestConfirmation({
        title: "توجد نسخة أحدث من المستند",
        description:
          "حُفظت تعديلات أخرى بعد فتح هذه الصفحة. أعد تحميل أحدث نسخة قبل متابعة التحرير؛ ستُستبدل التغييرات المحلية غير المحفوظة.",
        confirmLabel: "تحميل أحدث نسخة",
        cancelLabel: "البقاء للمراجعة",
        tone: "danger",
      });
      if (reload) {
        window.location.reload();
        return;
      }
      onNotify(
        "أُوقف الحفظ لحماية النسخة الأحدث. انسخ أي نص محلي مهم ثم أعد تحميل المشروع.",
      );
    },
    [onNotify, requestConfirmation],
  );
}
