export interface CharacterStudioControllerOptions {
  projectId: string;
  sourceVersionId: string;
  canvasSize: { width: number; height: number } | undefined;
  onNotify: (message: string) => void;
}

export const defaultCharacterReviewReason =
  "تمت مراجعة طبقات المصدر وتطابق الصورة المركبة مع الصورة المرفوعة.";

export function characterStudioErrorMessage(
  caught: unknown,
  fallback: string,
): string {
  return caught instanceof Error ? caught.message : fallback;
}
