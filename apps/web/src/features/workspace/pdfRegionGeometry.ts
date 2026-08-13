import type { MarkerLabel, PdfRegion } from "./PdfMarkerOverlay";

const MIN_NORMALIZED_PDF_REGION_SIZE = 0.005;

export interface PdfRegionPercentDraft {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PdfRegionGeometryResult =
  | {
      valid: true;
      region: Omit<PdfRegion, "id" | "order">;
    }
  | { valid: false; message: string };

export function createPdfRegionFromPercent(
  draft: PdfRegionPercentDraft,
  label: MarkerLabel,
): PdfRegionGeometryResult {
  if (!Object.values(draft).every(Number.isFinite)) {
    return { valid: false, message: "أدخل أرقامًا صحيحة لكل الإحداثيات." };
  }
  if (draft.x < 0 || draft.y < 0 || draft.x >= 100 || draft.y >= 100) {
    return {
      valid: false,
      message: "يجب أن يبدأ الموضع داخل الصفحة بين 0 و99 بالمئة.",
    };
  }
  if (draft.width < 1 || draft.height < 1) {
    return {
      valid: false,
      message: "يجب ألا يقل عرض المنطقة وارتفاعها عن 1 بالمئة.",
    };
  }
  if (draft.x + draft.width > 100 || draft.y + draft.height > 100) {
    return {
      valid: false,
      message: "تتجاوز المنطقة حدود الصفحة؛ قلّل الموضع أو الأبعاد.",
    };
  }
  return {
    valid: true,
    region: {
      x: draft.x / 100,
      y: draft.y / 100,
      width: draft.width / 100,
      height: draft.height / 100,
      label,
    },
  };
}

export function hasValidPdfRegionGeometry(
  region: Pick<PdfRegion, "x" | "y" | "width" | "height">,
): boolean {
  return (
    [region.x, region.y, region.width, region.height].every(Number.isFinite) &&
    region.x >= 0 &&
    region.y >= 0 &&
    region.width >= MIN_NORMALIZED_PDF_REGION_SIZE &&
    region.height >= MIN_NORMALIZED_PDF_REGION_SIZE &&
    region.x + region.width <= 1 &&
    region.y + region.height <= 1
  );
}

export function normalizePdfRegionOrders(
  regions: readonly PdfRegion[],
): PdfRegion[] {
  let readingOrder = 0;
  return regions.map((region) => {
    if (region.label === "exclude") return { ...region, order: null };
    readingOrder += 1;
    return { ...region, order: readingOrder };
  });
}
