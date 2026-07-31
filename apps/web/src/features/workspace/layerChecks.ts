import type { IconName } from "../../shared/Icon";
import type { Layer, ProjectMode } from "../../types";
import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";

interface LayerCheckItem {
  id: "names" | "structure" | "confidence";
  label: string;
  message: string;
  valid: boolean;
  icon: IconName;
}

export interface LayerCheckSummary {
  issueCount: number;
  title: string;
  description: string;
  items: LayerCheckItem[];
}

function hasLowConfidence(layer: Layer): boolean {
  return typeof layer.confidence === "number" && layer.confidence < 90;
}

export function getLayerCheckSummary(
  mode: ProjectMode,
  layers: readonly Layer[],
): LayerCheckSummary {
  const invalidNames = layers.filter(
    (layer) => !layer.name.startsWith("+") || layer.name.startsWith("++"),
  ).length;
  const lowConfidence = layers.filter(hasLowConfidence).length;
  const backgroundValid =
    mode === "image" ||
    layers
      .filter((layer) => layer.kind === "page")
      .every((layer) => layer.locked && layer.name.startsWith("+page_"));
  const layerLimitValid =
    mode === "book" || layers.length <= MAX_IMAGE_LAYERS;
  const issueCount =
    invalidNames +
    lowConfidence +
    Number(!backgroundValid) +
    Number(!layerLimitValid);
  const items: LayerCheckItem[] = [
    {
      id: "names",
      label: "تسمية الطبقات",
      message:
        invalidNames === 0
          ? "علامة + واحدة لكل اسم"
          : `${invalidNames} أسماء تحتاج تصحيحًا`,
      valid: invalidNames === 0,
      icon: invalidNames === 0 ? "check" : "warning",
    },
    {
      id: "structure",
      label: mode === "image" ? "حد الطبقات" : "خلفيات الصفحات",
      message:
        mode === "image"
          ? `${layers.length} من ${MAX_IMAGE_LAYERS} طبقة`
          : backgroundValid
            ? "ثابتة ومقفلة"
            : "توجد خلفية غير مطابقة",
      valid: backgroundValid && layerLimitValid,
      icon: backgroundValid && layerLimitValid ? "check" : "warning",
    },
    {
      id: "confidence",
      label: "ثقة الاكتشاف",
      message:
        lowConfidence === 0
          ? "لا توجد طبقات منخفضة الثقة"
          : `${lowConfidence} طبقات تستحسن مراجعتها`,
      valid: lowConfidence === 0,
      icon: lowConfidence === 0 ? "check" : "warning",
    },
  ];

  return {
    issueCount,
    title: issueCount === 0 ? "الفحص سليم" : "تحتاج مراجعة",
    description:
      issueCount === 0 ? "لا توجد مشكلات مكتشفة" : `${issueCount} ملاحظات فعلية`,
    items,
  };
}
