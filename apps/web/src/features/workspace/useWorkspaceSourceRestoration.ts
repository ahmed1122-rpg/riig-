import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import {
  ApiError,
  reanalyzePdfSource,
  type LayerDocumentView,
  type SourceVersionRestoreResult,
  type SourceVersionSummary,
} from "../../lib/api";
import type { UploadState } from "./SourceUploadStatus";
import { loadWorkspaceProjectDocument } from "./workspaceDocument";
import { pdfApiModes } from "./pdfSegmentation";

type SetState<Value> = Dispatch<SetStateAction<Value>>;

interface WorkspaceSourceRestorationOptions {
  mode: ProjectMode;
  pdfMode: PdfSegmentation;
  replaceLayerAssetUrls: (urls: string[]) => void;
  applyPreparedDocument: (
    document: LayerDocumentView,
    layers: Layer[],
    pdfPageNumber?: number,
  ) => void;
  resetLayerSelection: (layers: readonly Layer[]) => void;
  adoptSavedReview: (layers: Layer[], revision: number) => void;
  adoptDocument: (document: LayerDocumentView) => Promise<void>;
  setProcessing: SetState<boolean>;
  setSourceVersionId: SetState<string | undefined>;
  setSourceVersion: SetState<number>;
  setSourceName: SetState<string>;
  setSourceHash: SetState<string | undefined>;
  setSourcePreviewUrl: SetState<string | undefined>;
  setUploadState: SetState<UploadState>;
  setUploadProgress: SetState<number>;
  setUploadError: SetState<string | undefined>;
  setUploadDetailsOpen: SetState<boolean>;
  setGuidanceRevision: SetState<number>;
  onNotify: (message: string) => void;
}

export function useWorkspaceSourceRestoration(
  options: WorkspaceSourceRestorationOptions,
) {
  return useCallback(
    async (
      result: SourceVersionRestoreResult,
      version: SourceVersionSummary,
    ) => {
      const controller = new AbortController();
      options.setProcessing(true);
      options.setUploadState("verifying");
      options.setUploadProgress(0);
      options.setUploadError(undefined);
      try {
        let restored;
        try {
          restored = await loadWorkspaceProjectDocument(
            {
              id: result.project.id,
              currentSourceVersionId:
                result.project.currentSourceVersionId,
            },
            options.mode,
            controller.signal,
          );
        } catch (error) {
          if (
            !(error instanceof ApiError) ||
            error.code !== "DOCUMENT_NOT_FOUND"
          ) {
            throw error;
          }
          const document = await reanalyzePdfSource(
            result.project.id,
            version.id,
            options.mode === "book"
              ? pdfApiModes[options.pdfMode]
              : "sentence",
            {
              signal: controller.signal,
              onProgress: options.setUploadProgress,
            },
          );
          await options.adoptDocument(document);
          options.onNotify(
            "أُعيدت معالجة نسخة المصدر المستعادة لأنها لم تكن تملك وثيقة طبقات محفوظة.",
          );
        }
        if (restored) {
          options.replaceLayerAssetUrls(restored.previewUrls);
          options.applyPreparedDocument(
            restored.document,
            restored.preparedLayers,
          );
          options.resetLayerSelection(restored.preparedLayers);
          options.adoptSavedReview(
            restored.preparedLayers,
            restored.document.revision ?? 1,
          );
          options.setGuidanceRevision(
            restored.document.guidance?.revision ?? 0,
          );
        }
        options.setSourceVersionId(version.id);
        options.setSourceVersion(version.versionNumber);
        options.setSourceName(version.filename);
        options.setSourceHash(version.sha256 ?? undefined);
        options.setSourcePreviewUrl(undefined);
        options.setUploadState("ready");
        options.setUploadProgress(100);
      } catch (error) {
        options.setUploadState("error");
        options.setUploadError(
          error instanceof Error
            ? error.message
            : "تغير مؤشر المصدر في الخادم، لكن تعذر تحميل طبقاته أو إعادة معالجته.",
        );
        options.setUploadDetailsOpen(true);
        options.onNotify(
          "تغير مؤشر المصدر في الخادم، لكن الواجهة لم تعتمد هويته بعد. أعد مزامنة الطبقات قبل التحرير أو التصدير.",
        );
        throw error;
      } finally {
        options.setProcessing(false);
      }
    },
    [
      options.adoptDocument,
      options.adoptSavedReview,
      options.applyPreparedDocument,
      options.mode,
      options.onNotify,
      options.pdfMode,
      options.replaceLayerAssetUrls,
      options.resetLayerSelection,
      options.setGuidanceRevision,
      options.setProcessing,
      options.setSourceHash,
      options.setSourceName,
      options.setSourcePreviewUrl,
      options.setSourceVersion,
      options.setSourceVersionId,
      options.setUploadDetailsOpen,
      options.setUploadError,
      options.setUploadProgress,
      options.setUploadState,
    ],
  );
}
