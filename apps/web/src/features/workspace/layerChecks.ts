import type { IconName } from "../../shared/Icon";
import type { Layer, ProjectMode } from "../../types";
import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";
import type { ProductionIssue } from "@motionprep/contracts";
import { validateLayerGraph } from "@motionprep/layer-domain";
import { toDomainLayer } from "./workspaceLayerDomain";

interface LayerCheckItem {
  id: "names" | "graph" | "assets" | "structure" | "confidence";
  label: string;
  message: string;
  valid: boolean;
  icon: IconName;
}

interface LayerCheckDiagnostic {
  id: string;
  message: string;
  layerId?: string;
}

export interface LayerCheckSummary {
  issueCount: number;
  title: string;
  description: string;
  items: LayerCheckItem[];
  diagnostics: LayerCheckDiagnostic[];
}

function hasLowConfidence(layer: Layer): boolean {
  return typeof layer.confidence === "number" && layer.confidence < 90;
}

export function getLayerCheckSummary(
  mode: ProjectMode,
  layers: readonly Layer[],
): LayerCheckSummary {
  const contentLayers = layers.filter((layer) => layer.kind !== "group");
  const graphIssues = validateLayerGraph({
    schemaVersion: "1.0",
    projectId: "workspace-diagnostics",
    width: 1,
    height: 1,
    colorSpace: "sRGB",
    layers: layers.map(toDomainLayer),
  });
  const namingIssues = graphIssues.filter(({ code }) =>
    ["INVALID_LAYER_PREFIX", "INVALID_LAYER_NAME", "DUPLICATE_LAYER_NAME"].includes(code));
  const structuralIssues = graphIssues.filter(({ code }) =>
    !["INVALID_LAYER_PREFIX", "INVALID_LAYER_NAME", "DUPLICATE_LAYER_NAME"].includes(code));
  const missingRasterAssets = mode === "image"
    ? contentLayers.filter(
        (layer) =>
          layer.kind !== "text" &&
          layer.kind !== "page" &&
          layer.hasRasterAsset === false,
      )
    : [];
  const lowConfidence = contentLayers.filter(hasLowConfidence).length;
  const backgroundValid =
    mode === "image" ||
    layers
      .filter((layer) => layer.kind === "page")
      .every((layer) => layer.locked && layer.name.startsWith("+page_"));
  const layerLimitValid =
    mode === "book" || contentLayers.length <= MAX_IMAGE_LAYERS;
  const issueCount =
    namingIssues.length +
    structuralIssues.length +
    missingRasterAssets.length +
    lowConfidence +
    Number(!backgroundValid) +
    Number(!layerLimitValid);
  const items: LayerCheckItem[] = [
    {
      id: "names",
      label: "تسمية الطبقات",
      message:
        namingIssues.length === 0
          ? "الأسماء مطبّعة وفريدة داخل مجلداتها"
          : `${namingIssues.length} مشكلات تسمية تحتاج تصحيحًا`,
      valid: namingIssues.length === 0,
      icon: namingIssues.length === 0 ? "check" : "warning",
    },
    {
      id: "graph",
      label: "ترابط المجلدات",
      message: structuralIssues.length === 0
        ? "لا آباء مفقودون أو دورات أو روابط عابرة للصفحات"
        : `${structuralIssues.length} عيوب بنيوية في graph الطبقات`,
      valid: structuralIssues.length === 0,
      icon: structuralIssues.length === 0 ? "check" : "warning",
    },
    ...(mode === "image"
      ? [
          {
            id: "assets" as const,
            label: "أصول Raster",
            message:
              missingRasterAssets.length === 0
                ? "كل طبقة صورة مرتبطة بأصل محفوظ"
                : `${missingRasterAssets.length} طبقات بلا أصل Raster محفوظ`,
            valid: missingRasterAssets.length === 0,
            icon: (missingRasterAssets.length === 0
              ? "check"
              : "warning") as IconName,
          },
        ]
      : []),
    {
      id: "structure",
      label: mode === "image" ? "حد الطبقات" : "خلفيات الصفحات",
      message:
        mode === "image"
          ? `${contentLayers.length} من ${MAX_IMAGE_LAYERS} طبقة`
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
    diagnostics: [
      ...graphIssues.map((issue, index) => ({
        id: `${issue.code}:${issue.layerId ?? issue.pageNumber ?? index}`,
        message: diagnosticLabel(issue, layers),
        ...(issue.layerId ? { layerId: issue.layerId } : {}),
      })),
      ...missingRasterAssets.map((layer) => ({
        id: `IMAGE_RASTER_ASSET_MISSING:${layer.id}`,
        message: `أصل Raster مفقود · ${layer.name}`,
        layerId: layer.id,
      })),
    ].slice(0, 20),
  };
}

function diagnosticLabel(issue: ProductionIssue, layers: readonly Layer[]): string {
  const layer = issue.layerId
    ? layers.find((candidate) => candidate.id === issue.layerId)
    : undefined;
  const target = layer?.name ?? (issue.pageNumber ? `الصفحة ${issue.pageNumber}` : "المستند");
  const labels: Partial<Record<ProductionIssue["code"], string>> = {
    DUPLICATE_LAYER_ID: "معرّف مكرر",
    DUPLICATE_LAYER_NAME: "اسم مكرر داخل المجلد",
    MISSING_LAYER_PARENT: "مجلد أب مفقود",
    LAYER_PARENT_NOT_GROUP: "الأب ليس مجلدًا",
    LAYER_PARENT_CYCLE: "دورة في علاقات المجلدات",
    CROSS_PAGE_PARENT: "ارتباط بمجلد في صفحة أخرى",
    EMPTY_LAYER_GROUP: "مجلد فارغ",
    INVALID_LAYER_PREFIX: "بادئة اسم غير صحيحة",
    INVALID_LAYER_NAME: "اسم غير آمن أو غير مطبّع",
  };
  return `${labels[issue.code] ?? issue.code} · ${target}`;
}
