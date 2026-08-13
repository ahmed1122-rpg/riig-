import type { ProductionIssue } from "@motionprep/contracts";
import { validateProductionDocument } from "@motionprep/layer-domain";
import type { Layer, ProjectMode } from "../../types";
import type { WorkspaceSaveState } from "./WorkspaceChrome";
import { toDomainLayer } from "./workspaceLayerDomain";

export type ExportPreflightStatus = "ready" | "warning" | "blocked";

interface ExportPreflightFinding {
  key: string;
  severity: "warning" | "blocked";
  message: string;
  issue?: ProductionIssue;
}

export interface ExportPreflightResult {
  status: ExportPreflightStatus;
  findings: ExportPreflightFinding[];
}

export function evaluateExportPreflight(input: {
  mode: ProjectMode;
  layers: readonly Layer[];
  canExport: boolean;
  saveState: WorkspaceSaveState;
  canvasSize?: { width: number; height: number };
  pdfPages?: Array<{ pageNumber: number; width: number; height: number }>;
}): ExportPreflightResult {
  const width = input.canvasSize?.width ?? input.pdfPages?.[0]?.width ?? 1;
  const height = input.canvasSize?.height ?? input.pdfPages?.[0]?.height ?? 1;
  const issues = validateProductionDocument(
    {
      schemaVersion: "1.0",
      projectId: "workspace-preflight",
      width,
      height,
      colorSpace: "sRGB",
      layers: input.layers.map(toDomainLayer),
      ...(input.pdfPages ? { pages: input.pdfPages } : {}),
    },
    input.mode,
  );
  const findings: ExportPreflightFinding[] = issues.map((issue, index) => ({
    key: `${issue.code}:${issue.layerId ?? issue.pageNumber ?? index}`,
    severity: "blocked",
    message: productionIssueMessage(issue),
    issue,
  }));

  if (!input.canExport) {
    findings.unshift({
      key: "source-unavailable",
      severity: "blocked",
      message: "المصدر الحقيقي غير جاهز للتصدير.",
    });
  }
  const saveFinding = saveStateFinding(input.saveState);
  if (saveFinding) findings.unshift(saveFinding);

  const lowConfidence = input.layers.filter(
    (layer) => typeof layer.confidence === "number" && layer.confidence < 90,
  ).length;
  if (lowConfidence > 0) {
    findings.push({
      key: "low-confidence",
      severity: "warning",
      message: `${lowConfidence} طبقات منخفضة الثقة تستحسن مراجعتها قبل التصدير.`,
    });
  }

  return {
    status: findings.some(({ severity }) => severity === "blocked")
      ? "blocked"
      : findings.length > 0
        ? "warning"
        : "ready",
    findings,
  };
}

function saveStateFinding(
  state: WorkspaceSaveState,
): ExportPreflightFinding | undefined {
  if (state === "saved") return undefined;
  if (state === "dirty") {
    return {
      key: "save-dirty",
      severity: "warning",
      message: "توجد تعديلات محلية؛ سيُفرض حفظها قبل إنشاء التصدير.",
    };
  }
  const messages: Record<Exclude<WorkspaceSaveState, "saved" | "dirty">, string> = {
    unavailable: "الحفظ غير متاح لأن وثيقة الطبقات لم تجهز بعد.",
    saving: "انتظر اكتمال حفظ مراجعة الطبقات.",
    conflict: "توجد نسخة أحدث؛ أعد تحميل المشروع قبل التصدير.",
    error: "فشل حفظ مراجعة الطبقات؛ أعد الحفظ قبل التصدير.",
  };
  return {
    key: `save-${state}`,
    severity: "blocked",
    message: messages[state],
  };
}

function productionIssueMessage(issue: ProductionIssue): string {
  const page = issue.pageNumber ? ` في الصفحة ${issue.pageNumber}` : "";
  const messages: Record<ProductionIssue["code"], string> = {
    IMAGE_LAYER_LIMIT_EXCEEDED: "تجاوز عدد طبقات الصورة الحد المسموح.",
    IMAGE_RASTER_ASSET_MISSING: "توجد طبقة صورة بلا أصل Raster محفوظ.",
    IMAGE_RASTER_ASSET_DUPLICATE: "توجد طبقات صورة تشترك في أصل Raster واحد.",
    IMAGE_RASTER_BOUNDS_INVALID: "توجد طبقة صورة خارج حدود اللوحة.",
    INVALID_LAYER_PREFIX: "يجب أن يبدأ كل اسم بعلامة + واحدة فقط.",
    INVALID_LAYER_NAME: "يوجد اسم طبقة غير آمن أو غير مطبّع.",
    DUPLICATE_LAYER_ID: "يوجد معرّف طبقة مكرر.",
    DUPLICATE_LAYER_NAME: "يوجد اسم مكرر داخل المجلد نفسه.",
    MISSING_LAYER_PARENT: "توجد طبقة تشير إلى مجلد أب غير موجود.",
    LAYER_PARENT_NOT_GROUP: "توجد طبقة أب ليست مجلدًا.",
    LAYER_PARENT_CYCLE: "توجد دورة في علاقات مجلدات الطبقات.",
    CROSS_PAGE_PARENT: "توجد طبقة مرتبطة بمجلد في صفحة أخرى.",
    EMPTY_LAYER_GROUP: "يوجد مجلد طبقات فارغ.",
    PDF_PAGE_GROUP_MISSING: `مجلد الصفحة مفقود أو مكرر${page}.`,
    PDF_PAGE_GROUP_INVALID: `مجلد الصفحة غير ثابت أو غير مقفل${page}.`,
    PDF_BACKGROUND_MISSING: `الخلفية البيضاء الثابتة مفقودة أو مكررة${page}.`,
    PDF_BACKGROUND_NOT_FIXED: `خلفية الصفحة ليست ثابتة ومقفلة${page}.`,
  };
  return messages[issue.code];
}
