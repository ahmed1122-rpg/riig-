import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ApplicationCapabilities } from "@motionprep/contracts";
import type { ConfirmationRequest } from "../../shared/useConfirmation";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import { ApiError, type LayerDocumentView } from "../../lib/api";
import type { WorkspaceProps } from "./Workspace.types";
import type { UploadState } from "./SourceUploadStatus";
import { useWorkspaceUpload } from "./useWorkspaceUpload";
import { loadWorkspaceProjectDocument } from "./workspaceDocument";

type SetState<Value> = Dispatch<SetStateAction<Value>>;

interface WorkspaceProjectLifecycleOptions {
  mode: ProjectMode;
  maxUploadBytes: ApplicationCapabilities["limits"]["maxUploadBytes"];
  authenticated: boolean;
  persistedSource: boolean;
  sourceName: string;
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
  adoptSavedReview: (layers: Layer[], revision: number) => void;
  resetLayerSelection: (layers: readonly Layer[]) => void;
  setImageLayers: SetState<Layer[]>;
  setBookLayers: SetState<Layer[]>;
  setProjectId: SetState<string | undefined>;
  setSourceVersionId: SetState<string | undefined>;
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

  const { chooseSource, cancelUpload } = useWorkspaceUpload({
    mode: options.mode,
    maxUploadBytes: options.maxUploadBytes,
    authenticated: options.authenticated,
    persistedSource: options.persistedSource,
    sourceName: options.sourceName,
    ...(options.projectId ? { projectId: options.projectId } : {}),
    pdfMode: options.pdfMode,
    onRequireAuth: options.onRequireAuth,
    onNotify: options.onNotify,
    confirmSourceReplacement: options.requestConfirmation,
    onLayerAssetUrls: replaceLayerAssetUrls,
    onDocumentReady: (file, result, preparedLayers) => {
      options.setProjectId(result.projectId);
      options.setSourceVersionId(result.sourceVersionId);
      options.setSourceHash(result.sha256);
      applyPreparedDocument(result.document, preparedLayers);
      options.resetLayerSelection(preparedLayers);
      options.setSourcePreviewUrl(URL.createObjectURL(file));
      options.adoptSavedReview(
        preparedLayers,
        result.document.revision ?? 1,
      );
      options.setGuidanceRevision(
        result.document.guidance?.revision ?? 0,
      );
      options.setSourceVersion(result.sourceVersionNumber);
    },
    setSourceName: options.setSourceName,
    setUploadState: options.setUploadState,
    setUploadProgress: options.setUploadProgress,
    setUploadError: options.setUploadError,
    setUploadDetailsOpen: options.setUploadDetailsOpen,
  });

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
    if (!options.initialProject || !options.authenticated) return;
    const controller = new AbortController();
    options.setUploadState("verifying");
    options.setUploadProgress(0);
    options.setUploadError(undefined);
    options.setSourceName(options.initialProject.name);
    options.setProjectId(options.initialProject.id);

    void loadWorkspaceProjectDocument(
      options.initialProject,
      options.mode,
      controller.signal,
    )
      .then(({ document, preparedLayers, previewUrls }) => {
        if (controller.signal.aborted) return;
        replaceLayerAssetUrls(previewUrls);
        options.setSourceVersionId(document.sourceVersionId);
        options.adoptSavedReview(
          preparedLayers,
          document.revision ?? 1,
        );
        options.setGuidanceRevision(document.guidance?.revision ?? 0);
        options.setSourceVersion(
          options.initialProject?.currentSourceVersionNumber ?? 1,
        );
        options.setUploadState("ready");
        options.setUploadProgress(100);
        applyPreparedDocument(document, preparedLayers);
        options.resetLayerSelection(preparedLayers);
      })
      .catch((caught: unknown) => {
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
    options.authenticated,
    options.initialProject,
    options.mode,
    options.resetLayerSelection,
    options.setGuidanceRevision,
    options.setProjectId,
    options.setSourceName,
    options.setSourceVersion,
    options.setSourceVersionId,
    options.setUploadDetailsOpen,
    options.setUploadError,
    options.setUploadProgress,
    options.setUploadState,
    replaceLayerAssetUrls,
  ]);

  return {
    applyPreparedDocument,
    cancelUpload,
    chooseSource,
    replaceLayerAssetUrls,
  };
}
