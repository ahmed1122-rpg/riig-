import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ExportFormat } from "@motionprep/contracts";
import type { PdfSegmentation } from "../../types";
import type { ConfirmationRequest } from "../../shared/useConfirmation";
import {
  applyGuidedRefinement,
  createExportArtifact,
  navigateLayerDocumentHistory,
  reanalyzePdfSource,
  type LayerDocumentView,
} from "../../lib/api";
import type { UploadState } from "./SourceUploadStatus";
import type { WorkspaceSaveState } from "./WorkspaceChrome";
import {
  pdfApiModes,
  pdfSegmentationLabels,
} from "./pdfSegmentation";
import {
  createImageGuidedRefinementInput,
  createPdfGuidedRefinementInput,
  type GuidedRefinementContext,
  type GuidedRefinementInput,
  type ImageGuideInput,
  type PdfGuideInput,
} from "./workspaceGuidance";

type SetState<Value> = Dispatch<SetStateAction<Value>>;

export interface WorkspaceExportOptions {
  scope?: "full-document" | "per-page" | "selected-page";
  selectedPage?: number;
  scale: 1;
  colorProfile: "sRGB";
  namingPresetId: string;
}

interface WorkspaceOperationsOptions {
  projectId?: string;
  sourceVersionId?: string;
  activeLayerId: string;
  activePdfPage: number;
  guidanceRevision: number;
  layerDocumentRevision?: number;
  pdfMode: PdfSegmentation;
  saveInFlightRef: MutableRefObject<boolean>;
  flushLayerReview: () => Promise<number>;
  adoptDocument: (
    document: LayerDocumentView,
    preferredLayerId?: string,
  ) => Promise<void>;
  requestConfirmation: (request: ConfirmationRequest) => Promise<boolean>;
  setProcessing: SetState<boolean>;
  setSaveState: SetState<WorkspaceSaveState>;
  setUploadState: SetState<UploadState>;
  setUploadProgress: SetState<number>;
  setPdfMode: SetState<PdfSegmentation>;
  onNotify: (message: string) => void;
}

export function useWorkspaceOperations(options: WorkspaceOperationsOptions) {
  const executeGuidedRefinement = useCallback(
    async (
      missingSourceMessage: string,
      buildInput: (context: GuidedRefinementContext) => GuidedRefinementInput,
      preferCreatedLayer = false,
    ): Promise<{ revision: number; warnings: string[] }> => {
      if (!options.projectId || !options.sourceVersionId) {
        throw new Error(missingSourceMessage);
      }
      if (options.saveInFlightRef.current) {
        throw new Error("انتظر اكتمال الحفظ الجاري ثم أعد تطبيق الإرشاد.");
      }
      options.saveInFlightRef.current = true;
      options.setProcessing(true);
      options.setSaveState("saving");
      try {
        const baseRevision = await options.flushLayerReview();
        const result = await applyGuidedRefinement(
          options.projectId,
          buildInput({
            sourceVersionId: options.sourceVersionId,
            baseRevision,
            appliedAt: new Date().toISOString(),
          }),
        );
        await options.adoptDocument(
          result.document,
          preferCreatedLayer
            ? result.createdLayerIds[0] ?? options.activeLayerId
            : undefined,
        );
        return {
          revision:
            result.document.guidance?.revision ??
            options.guidanceRevision + 1,
          warnings: result.warnings,
        };
      } finally {
        options.saveInFlightRef.current = false;
        options.setProcessing(false);
      }
    },
    [
      options.activeLayerId,
      options.adoptDocument,
      options.flushLayerReview,
      options.guidanceRevision,
      options.projectId,
      options.saveInFlightRef,
      options.setProcessing,
      options.setSaveState,
      options.sourceVersionId,
    ],
  );

  const applyImageGuide = useCallback(
    (input: ImageGuideInput) =>
      executeGuidedRefinement(
        "ارفع صورة قبل استخدام قلم التحديد.",
        (context) =>
          createImageGuidedRefinementInput(
            input,
            options.activeLayerId,
            context,
          ),
        true,
      ),
    [executeGuidedRefinement, options.activeLayerId],
  );

  const applyPdfGuide = useCallback(
    (input: PdfGuideInput) =>
      executeGuidedRefinement(
        "ارفع ملف PDF قبل استخدام قلم التحديد.",
        (context) =>
          createPdfGuidedRefinementInput(
            input,
            options.activePdfPage,
            context,
          ),
      ),
    [executeGuidedRefinement, options.activePdfPage],
  );

  const navigateDocumentHistory = useCallback(
    async (direction: "undo" | "redo"): Promise<void> => {
      if (!options.projectId || !options.sourceVersionId) {
        options.onNotify("ارفع مصدرًا وجهّزه قبل التنقل في سجل التعديلات.");
        return;
      }
      options.setProcessing(true);
      try {
        const baseRevision = await options.flushLayerReview();
        const document = await navigateLayerDocumentHistory(
          options.projectId,
          {
            sourceVersionId: options.sourceVersionId,
            baseRevision,
            direction,
          },
        );
        await options.adoptDocument(document);
        options.onNotify(
          direction === "undo"
            ? "تم التراجع عن آخر تعديل محفوظ."
            : "تمت إعادة التعديل المحفوظ التالي.",
        );
      } catch (error) {
        options.onNotify(
          error instanceof Error
            ? error.message
            : "تعذر التنقل في سجل التعديلات.",
        );
      } finally {
        options.setProcessing(false);
      }
    },
    [
      options.adoptDocument,
      options.flushLayerReview,
      options.onNotify,
      options.projectId,
      options.setProcessing,
      options.sourceVersionId,
    ],
  );

  const changePdfSegmentation = useCallback(
    async (nextMode: PdfSegmentation): Promise<void> => {
      if (nextMode === options.pdfMode) return;
      if (!options.projectId || !options.sourceVersionId) {
        options.setPdfMode(nextMode);
        return;
      }
      const confirmed = await options.requestConfirmation({
        title: "إعادة تحليل ملف PDF؟",
        description:
          "ستُعاد قراءة الملف بهذا النمط، وستُستبدل مراجعة الطبقات " +
          "والعلامات اليدوية الحالية.",
        confirmLabel: "إعادة التحليل",
        tone: "danger",
      });
      if (!confirmed) return;
      if (options.saveInFlightRef.current) {
        options.onNotify("انتظر اكتمال الحفظ الجاري قبل تغيير نمط التقطيع.");
        return;
      }
      options.setProcessing(true);
      options.setUploadState("verifying");
      options.setUploadProgress(0);
      try {
        const document = await reanalyzePdfSource(
          options.projectId,
          options.sourceVersionId,
          pdfApiModes[nextMode],
          { onProgress: options.setUploadProgress },
        );
        await options.adoptDocument(document);
        options.setPdfMode(nextMode);
        options.setUploadState("ready");
        options.setUploadProgress(100);
        options.onNotify(
          `أُعيد تحليل PDF إلى ${pdfSegmentationLabels[nextMode]} مع تحديث الطبقات وترتيب القراءة.`,
        );
      } catch (error) {
        options.setUploadState("ready");
        options.setUploadProgress(100);
        options.onNotify(
          error instanceof Error
            ? error.message
            : "تعذر تغيير نمط تقطيع PDF.",
        );
      } finally {
        options.setProcessing(false);
      }
    },
    [
      options.adoptDocument,
      options.onNotify,
      options.pdfMode,
      options.projectId,
      options.requestConfirmation,
      options.saveInFlightRef,
      options.setPdfMode,
      options.setProcessing,
      options.setUploadProgress,
      options.setUploadState,
      options.sourceVersionId,
    ],
  );

  const createExport = useCallback(
    async (format: ExportFormat, exportOptions?: WorkspaceExportOptions) => {
      if (!options.projectId || !options.sourceVersionId) {
        throw new Error("ارفع مصدرًا حقيقيًا قبل إنشاء ملف التصدير.");
      }
      if (options.layerDocumentRevision === undefined) {
        throw new Error("تعذر تحديد إصدار وثيقة الطبقات. أعد تحميل المصدر.");
      }
      const saveDeadline = Date.now() + 10_000;
      while (
        options.saveInFlightRef.current &&
        Date.now() < saveDeadline
      ) {
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      }
      if (options.saveInFlightRef.current) {
        throw new Error(
          "استمر الحفظ التلقائي أكثر من المتوقع. أعد المحاولة بعد التحقق من الاتصال.",
        );
      }
      const documentRevision = await options.flushLayerReview();
      await createExportArtifact(
        options.projectId,
        options.sourceVersionId,
        documentRevision,
        format,
        exportOptions,
      );
    },
    [
      options.flushLayerReview,
      options.layerDocumentRevision,
      options.projectId,
      options.saveInFlightRef,
      options.sourceVersionId,
    ],
  );

  return {
    applyImageGuide,
    applyPdfGuide,
    changePdfSegmentation,
    createExport,
    navigateDocumentHistory,
  };
}
