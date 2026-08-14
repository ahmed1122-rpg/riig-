import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { ExportFormat } from "@motionprep/contracts";
import type { Layer, PdfSegmentation } from "../../types";
import type { ConfirmationRequest } from "../../shared/useConfirmation";
import {
  approveProjectReview,
  applyGuidedRefinement,
  createExportArtifact,
  navigateLayerDocumentHistory,
  reanalyzePdfSource,
  type LayerDocumentView,
} from "../../lib/api";
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
import type { DocumentCommandCoordinator } from "./useDocumentCommandCoordinator";
import type { RecordDocumentChange } from "./documentChangeSummary";
import {
  workspaceCommandError,
  type WorkspaceCommandStatus,
} from "./workspaceCommandStatus";

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
  layers: readonly Layer[];
  onDocumentChanged: RecordDocumentChange;
  commandCoordinator: DocumentCommandCoordinator;
  adoptDocument: (
    document: LayerDocumentView,
    preferredLayerId?: string,
  ) => Promise<void>;
  requestConfirmation: (request: ConfirmationRequest) => Promise<boolean>;
  setProcessing: SetState<boolean>;
  setSaveState: SetState<WorkspaceSaveState>;
  setCommandStatus: SetState<WorkspaceCommandStatus>;
  setPdfMode: SetState<PdfSegmentation>;
  onNotify: (message: string) => void;
}

export function useWorkspaceOperations(options: WorkspaceOperationsOptions) {
  const executeGuidedRefinement = useCallback(
    async (
      missingSourceMessage: string,
      changeLabel: string,
      buildInput: (context: GuidedRefinementContext) => GuidedRefinementInput,
      preferCreatedLayer = false,
    ): Promise<{ revision: number; warnings: string[] }> => {
      if (!options.projectId || !options.sourceVersionId) {
        throw new Error(missingSourceMessage);
      }
      options.setProcessing(true);
      options.setSaveState("saving");
      options.setCommandStatus({ phase: "running", label: changeLabel });
      try {
        const result = await options.commandCoordinator.run(async ({ baseRevision, signal }) => {
          const before = options.layers;
          if (baseRevision === undefined) throw new Error("وثيقة الطبقات غير جاهزة.");
          const result = await applyGuidedRefinement(
            options.projectId!,
            buildInput({
              sourceVersionId: options.sourceVersionId!,
              baseRevision,
              appliedAt: new Date().toISOString(),
            }),
            signal,
          );
          options.onDocumentChanged(changeLabel, before, result.document);
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
        });
        options.setCommandStatus({ phase: "idle" });
        return result;
      } catch (error) {
        options.setSaveState("error");
        options.setCommandStatus(
          workspaceCommandError(
            changeLabel,
            error,
            "تعذر تطبيق التحسين الإرشادي.",
          ),
        );
        throw error;
      } finally {
        options.setProcessing(false);
      }
    },
    [
      options.activeLayerId,
      options.adoptDocument,
      options.commandCoordinator,
      options.guidanceRevision,
      options.layers,
      options.onDocumentChanged,
      options.projectId,
      options.setProcessing,
      options.setSaveState,
      options.setCommandStatus,
      options.sourceVersionId,
    ],
  );

  const applyImageGuide = useCallback(
    (input: ImageGuideInput) =>
      executeGuidedRefinement(
        "ارفع صورة قبل استخدام قلم التحديد.",
        "تحسين إرشادي للصورة",
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
        "تحسين إرشادي لـPDF",
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
      const label = direction === "undo" ? "التراجع" : "الإعادة";
      options.setCommandStatus({ phase: "running", label });
      try {
        await options.commandCoordinator.run(async ({ baseRevision, signal }) => {
          const before = options.layers;
          if (baseRevision === undefined) throw new Error("وثيقة الطبقات غير جاهزة.");
          const document = await navigateLayerDocumentHistory(
            options.projectId!,
            {
              sourceVersionId: options.sourceVersionId!,
              baseRevision,
              direction,
            },
            signal,
          );
          options.onDocumentChanged(
            direction === "undo" ? "تراجع" : "إعادة",
            before,
            document,
          );
          await options.adoptDocument(document);
        });
        options.onNotify(
          direction === "undo"
            ? "تم التراجع عن آخر تعديل محفوظ."
            : "تمت إعادة التعديل المحفوظ التالي.",
        );
        options.setCommandStatus({ phase: "idle" });
      } catch (error) {
        options.setCommandStatus(
          workspaceCommandError(
            label,
            error,
            "تعذر التنقل في سجل التعديلات.",
          ),
        );
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
      options.commandCoordinator,
      options.layers,
      options.onNotify,
      options.onDocumentChanged,
      options.projectId,
      options.setCommandStatus,
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
      options.setProcessing(true);
      const label = "إعادة تحليل PDF";
      options.setCommandStatus({ phase: "running", label, progress: 0 });
      try {
        await options.commandCoordinator.run(async ({ signal }) => {
          const before = options.layers;
          const document = await reanalyzePdfSource(
            options.projectId!,
            options.sourceVersionId!,
            pdfApiModes[nextMode],
            {
              signal,
              onProgress: (progress) =>
                options.setCommandStatus((current) =>
                  current.phase === "running"
                    ? { ...current, progress }
                    : current,
                ),
            },
          );
          options.onDocumentChanged("إعادة تحليل PDF", before, document);
          await options.adoptDocument(document);
        });
        options.setPdfMode(nextMode);
        options.setCommandStatus({ phase: "idle" });
        options.onNotify(
          `أُعيد تحليل PDF إلى ${pdfSegmentationLabels[nextMode]} مع تحديث الطبقات وترتيب القراءة.`,
        );
      } catch (error) {
        options.setCommandStatus(
          workspaceCommandError(
            label,
            error,
            "تعذر تغيير نمط تقطيع PDF.",
          ),
        );
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
      options.commandCoordinator,
      options.layers,
      options.onNotify,
      options.onDocumentChanged,
      options.pdfMode,
      options.projectId,
      options.requestConfirmation,
      options.setPdfMode,
      options.setCommandStatus,
      options.setProcessing,
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
      await options.commandCoordinator.run(async ({ baseRevision, signal }) => {
        if (baseRevision === undefined) throw new Error("وثيقة الطبقات غير جاهزة.");
        await approveProjectReview(
          options.projectId!,
          options.sourceVersionId!,
          baseRevision,
          signal,
        );
        await createExportArtifact(
          options.projectId!,
          options.sourceVersionId!,
          baseRevision,
          format,
          { ...exportOptions, signal },
        );
      });
    },
    [
      options.commandCoordinator,
      options.layerDocumentRevision,
      options.projectId,
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
