import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ApplicationCapabilities } from "@motionprep/contracts";
import type { ConfirmationRequest } from "../../shared/useConfirmation";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import {
  ApiError,
  getProject,
  type LayerDocumentView,
  type ProjectSummary,
} from "../../lib/api";
import { useResourcePolling } from "../../shared/hooks/useResourcePolling";
import type {
  WorkspaceProps,
  WorkspaceSetState as SetState,
} from "./Workspace.types";
import type { UploadState } from "./SourceUploadStatus";
import { useWorkspaceUpload } from "./useWorkspaceUpload";
import { loadWorkspaceProjectDocument } from "./workspaceDocument";
import type { DocumentCommandCoordinator } from "./useDocumentCommandCoordinator";

const pendingProjectStatuses = new Set([
  "validating",
  "uploading",
  "queued",
  "processing",
]);

interface WorkspaceProjectLifecycleOptions {
  mode: ProjectMode;
  maxUploadBytes: ApplicationCapabilities["limits"]["maxUploadBytes"];
  authenticated: boolean;
  persistedSource: boolean;
  sourceName: string;
  hasUnsavedEditorDraft?: boolean;
  projectId?: string;
  sourceVersionId?: string;
  sourcePreviewUrl?: string;
  pdfMode: PdfSegmentation;
  initialProject: WorkspaceProps["initialProject"];
  onRequireAuth: () => void;
  onNotify: (message: string) => void;
  requestConfirmation: (
    request: ConfirmationRequest,
  ) => Promise<boolean>;
  commandCoordinator: DocumentCommandCoordinator;
  adoptSavedReview: (layers: Layer[], revision: number) => void;
  resetLayerSelection: (layers: readonly Layer[]) => void;
  setImageLayers: SetState<Layer[]>;
  setBookLayers: SetState<Layer[]>;
  setProjectId: SetState<string | undefined>;
  setSourceVersionId: SetState<string | undefined>;
  setPendingUploadId: SetState<string | undefined>;
  setPendingSourceVersionId: SetState<string | undefined>;
  setProcessingJobId: SetState<string | undefined>;
  setSourceHash: SetState<string | undefined>;
  setSourcePreviewUrl: SetState<string | undefined>;
  setImageCanvasSize: SetState<
    { width: number; height: number } | undefined
  >;
  setImagePreparation: SetState<
    LayerDocumentView["imagePreparation"]
  >;
  setOcrReview: SetState<LayerDocumentView["ocrReview"]>;
  setGuidanceRevision: SetState<number>;
  setSourceVersion: SetState<number>;
  setSourceName: SetState<string>;
  setUploadState: SetState<UploadState>;
  setUploadProgress: SetState<number>;
  setUploadError: SetState<string | undefined>;
  setUploadDetailsOpen: SetState<boolean>;
  setPdfPages: SetState<
    Array<{ pageNumber: number; width: number; height: number }>
  >;
  setActivePdfPage: SetState<number>;
  setPdfPageSize: SetState<
    { width: number; height: number } | undefined
  >;
  setPdfPageCount: SetState<number>;
}

export function useWorkspaceProjectLifecycle(
  options: WorkspaceProjectLifecycleOptions,
) {
  const layerAssetUrlsRef = useRef<string[]>([]);
  const [projectToHydrate, setProjectToHydrate] =
    useState<ProjectSummary>();

  const replaceLayerAssetUrls = useCallback((urls: string[]) => {
    for (const url of layerAssetUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    layerAssetUrlsRef.current = urls;
  }, []);

  const applyPreparedDocument = useCallback(
    (
      document: LayerDocumentView,
      preparedLayers: Layer[],
      pdfPageNumber?: number,
    ) => {
      if (options.mode === "image") {
        options.setImageLayers(preparedLayers);
        options.setImageCanvasSize({
          width: document.width,
          height: document.height,
        });
        options.setImagePreparation(document.imagePreparation);
        options.setOcrReview(undefined);
        return;
      }
      options.setBookLayers(preparedLayers);
      options.setOcrReview(document.ocrReview);
      options.setPdfPages(document.pages ?? []);
      const page =
        pdfPageNumber === undefined
          ? document.pages?.[0]
          : document.pages?.find(
              (candidate) => candidate.pageNumber === pdfPageNumber,
            ) ?? document.pages?.[0];
      options.setActivePdfPage(page?.pageNumber ?? 1);
      options.setPdfPageSize(
        page
          ? { width: page.width, height: page.height }
          : { width: document.width, height: document.height },
      );
      options.setPdfPageCount(document.pages?.length ?? 1);
    },
    [
      options.mode,
      options.setActivePdfPage,
      options.setBookLayers,
      options.setImageCanvasSize,
      options.setImageLayers,
      options.setImagePreparation,
      options.setOcrReview,
      options.setPdfPageCount,
      options.setPdfPages,
      options.setPdfPageSize,
    ],
  );

  const { chooseSource, cancelUpload: cancelActiveUpload } = useWorkspaceUpload({
    mode: options.mode,
    maxUploadBytes: options.maxUploadBytes,
    authenticated: options.authenticated,
    persistedSource: options.persistedSource,
    sourceName: options.sourceName,
    ...(options.hasUnsavedEditorDraft === undefined
      ? {}
      : { hasUnsavedEditorDraft: options.hasUnsavedEditorDraft }),
    ...(options.projectId ? { projectId: options.projectId } : {}),
    pdfMode: options.pdfMode,
    commandCoordinator: options.commandCoordinator,
    onRequireAuth: options.onRequireAuth,
    onNotify: options.onNotify,
    confirmSourceReplacement: options.requestConfirmation,
    onLayerAssetUrls: replaceLayerAssetUrls,
    onLifecycleUpdate: (update) => {
      options.setProjectId(update.projectId);
      if (update.uploadId) options.setPendingUploadId(update.uploadId);
      if (update.sourceVersionId) {
        options.setPendingSourceVersionId(update.sourceVersionId);
      }
      if (update.processingJobId) {
        options.setProcessingJobId(update.processingJobId);
      }
    },
    onDocumentReady: (file, result, preparedLayers) => {
      options.setProjectId(result.projectId);
      options.setSourceVersionId(result.sourceVersionId);
      options.setSourceHash(result.sha256);
      applyPreparedDocument(result.document, preparedLayers);
      options.resetLayerSelection(preparedLayers);
      options.setSourcePreviewUrl(
        options.mode === "image" ? URL.createObjectURL(file) : undefined,
      );
      options.adoptSavedReview(
        preparedLayers,
        result.document.revision ?? 1,
      );
      options.setGuidanceRevision(
        result.document.guidance?.revision ?? 0,
      );
      options.setSourceVersion(result.sourceVersionNumber);
      options.setPendingUploadId(undefined);
      options.setPendingSourceVersionId(undefined);
      options.setProcessingJobId(undefined);
    },
    setSourceName: options.setSourceName,
    setUploadState: options.setUploadState,
    setUploadProgress: options.setUploadProgress,
    setUploadError: options.setUploadError,
    setUploadDetailsOpen: options.setUploadDetailsOpen,
  });
  const cancelUpload = () => {
    cancelActiveUpload();
    options.setPendingUploadId(undefined);
    options.setPendingSourceVersionId(undefined);
    options.setProcessingJobId(undefined);
  };

  useEffect(
    () => () => {
      for (const url of layerAssetUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    },
    [],
  );

  useEffect(
    () => () => {
      if (options.sourcePreviewUrl) {
        URL.revokeObjectURL(options.sourcePreviewUrl);
      }
    },
    [options.sourcePreviewUrl],
  );

  useEffect(() => {
    if (!options.initialProject || !options.authenticated) {
      setProjectToHydrate(undefined);
      return;
    }
    options.setUploadState("verifying");
    options.setUploadProgress(0);
    options.setUploadError(undefined);
    options.setSourceName(options.initialProject.name);
    options.setProjectId(options.initialProject.id);
    setProjectToHydrate(undefined);
  }, [
    options.authenticated,
    options.initialProject,
    options.setProjectId,
    options.setSourceName,
    options.setUploadError,
    options.setUploadProgress,
    options.setUploadState,
  ]);

  useResourcePolling({
    enabled: Boolean(options.initialProject && options.authenticated),
    resourceKey: `workspace-project:${options.initialProject?.id ?? "none"}`,
    revision: options.initialProject?.currentSourceVersionNumber ?? 0,
    intervalMs: 1_500,
    maximumRetryIntervalMs: 15_000,
    load: async (signal) => {
      const project = await getProject(options.initialProject!.id, signal);
      if (project.kind !== options.mode) {
        throw new ApiError(
          "PROJECT_KIND_MISMATCH",
          "نوع المشروع لا يطابق وضع مساحة العمل. افتح المشروع من قائمة المشاريع لتصحيح الرابط.",
          409,
        );
      }
      return project;
    },
    shouldPoll: (project) => pendingProjectStatuses.has(project.status),
    onSuccess: (project) => {
      options.setProjectId(project.id);
      options.setSourceName(project.name);
      if (pendingProjectStatuses.has(project.status)) {
        options.setUploadState("verifying");
        options.setUploadProgress(projectProgress(project.status));
        return;
      }
      if (!project.currentSourceVersionId) {
        options.setUploadProgress(0);
        if (project.status === "draft") {
          options.setUploadState("empty");
          options.setUploadDetailsOpen(false);
          return;
        }
        options.setUploadState("error");
        options.setUploadError(
          "لم يكتمل تجهيز مصدر هذا المشروع. يمكنك اختيار الملف مجددًا لإعادة استخدام المشروع نفسه.",
        );
        options.setUploadDetailsOpen(true);
        return;
      }
      setProjectToHydrate(project);
    },
    onError: (caught) => {
      options.setUploadState("error");
      options.setUploadProgress(0);
      options.setUploadError(
        caught instanceof ApiError
          ? caught.message
          : "تعذر فتح وثيقة الطبقات لهذا المشروع.",
      );
      options.setUploadDetailsOpen(true);
    },
  });

  useEffect(() => {
    if (!projectToHydrate) return;
    const controller = new AbortController();
    void loadWorkspaceProjectDocument(
      projectToHydrate,
      options.mode,
      controller.signal,
    ).then(({ document, preparedLayers, previewUrls }) => {
      if (controller.signal.aborted) return;
      replaceLayerAssetUrls(previewUrls);
      options.setSourceVersionId(document.sourceVersionId);
      options.setPendingUploadId(undefined);
      options.setPendingSourceVersionId(undefined);
      options.setProcessingJobId(undefined);
      options.adoptSavedReview(preparedLayers, document.revision ?? 1);
      options.setGuidanceRevision(document.guidance?.revision ?? 0);
      options.setSourceVersion(
        projectToHydrate.currentSourceVersionNumber ?? 1,
      );
      options.setUploadState("ready");
      options.setUploadProgress(100);
      applyPreparedDocument(document, preparedLayers);
      options.resetLayerSelection(preparedLayers);
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      options.setUploadState("error");
      options.setUploadProgress(0);
      options.setUploadError(
        caught instanceof ApiError
          ? caught.message
          : "تعذر فتح وثيقة الطبقات لهذا المشروع.",
      );
      options.setUploadDetailsOpen(true);
    });
    return () => controller.abort();
  }, [
    applyPreparedDocument,
    options.adoptSavedReview,
    options.mode,
    options.resetLayerSelection,
    options.setGuidanceRevision,
    options.setPendingSourceVersionId,
    options.setPendingUploadId,
    options.setProcessingJobId,
    options.setProjectId,
    options.setSourceName,
    options.setSourceVersion,
    options.setSourceVersionId,
    options.setUploadDetailsOpen,
    options.setUploadError,
    options.setUploadProgress,
    options.setUploadState,
    projectToHydrate,
    replaceLayerAssetUrls,
  ]);

  return {
    applyPreparedDocument,
    cancelUpload,
    chooseSource,
    replaceLayerAssetUrls,
  };
}

function projectProgress(status: string): number {
  return {
    validating: 20,
    uploading: 40,
    queued: 65,
    processing: 80,
  }[status] ?? 0;
}
