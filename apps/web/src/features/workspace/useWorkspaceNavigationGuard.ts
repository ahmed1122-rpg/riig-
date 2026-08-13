import { useCallback, useEffect } from "react";

interface WorkspaceNavigationGuardOptions {
  hasUnsavedReview: () => boolean;
  flushLayerReview: () => Promise<number>;
  hasUnsavedDraft: () => boolean;
  confirmDiscardDraft: () => Promise<boolean>;
  onNavigationGuardChange: (
    guard: (() => Promise<boolean>) | null,
  ) => void;
  onNotify: (message: string) => void;
}

export function useWorkspaceNavigationGuard(
  options: WorkspaceNavigationGuardOptions,
) {
  const allowNavigation = useCallback(async () => {
    if (options.hasUnsavedReview()) {
      try {
        await options.flushLayerReview();
      } catch {
        options.onNotify(
          "تعذر حفظ آخر تعديل؛ أُوقف التنقل لحماية عملك. أعد المحاولة بعد استقرار الاتصال.",
        );
        return false;
      }
    }
    if (options.hasUnsavedDraft()) {
      return options.confirmDiscardDraft();
    }
    return true;
  }, [
    options.confirmDiscardDraft,
    options.flushLayerReview,
    options.hasUnsavedDraft,
    options.hasUnsavedReview,
    options.onNotify,
  ]);

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!options.hasUnsavedDraft() && !options.hasUnsavedReview()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [options.hasUnsavedDraft, options.hasUnsavedReview]);

  useEffect(() => {
    options.onNavigationGuardChange(allowNavigation);
    return () => options.onNavigationGuardChange(null);
  }, [allowNavigation, options.onNavigationGuardChange]);
}
