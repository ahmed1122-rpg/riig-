import { useCallback, useEffect } from "react";

interface WorkspaceNavigationGuardOptions {
  hasUnsavedReview: () => boolean;
  flushLayerReview: () => Promise<number>;
  onNavigationGuardChange: (
    guard: (() => Promise<boolean>) | null,
  ) => void;
  onNotify: (message: string) => void;
}

export function useWorkspaceNavigationGuard(
  options: WorkspaceNavigationGuardOptions,
) {
  const allowNavigation = useCallback(async () => {
    if (!options.hasUnsavedReview()) return true;
    try {
      await options.flushLayerReview();
      return true;
    } catch {
      options.onNotify(
        "تعذر حفظ آخر تعديل؛ أُوقف التنقل لحماية عملك. أعد المحاولة بعد استقرار الاتصال.",
      );
      return false;
    }
  }, [
    options.flushLayerReview,
    options.hasUnsavedReview,
    options.onNotify,
  ]);

  useEffect(() => {
    options.onNavigationGuardChange(allowNavigation);
    return () => options.onNavigationGuardChange(null);
  }, [allowNavigation, options.onNavigationGuardChange]);
}
