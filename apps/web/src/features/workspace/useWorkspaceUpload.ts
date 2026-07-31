import {
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MEBIBYTES,
} from "@motionprep/contracts";
import {
  ApiError,
  createAndUploadSource,
} from "../../lib/api";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import type { UploadState } from "./SourceUploadStatus";
import { pdfApiModes } from "./pdfSegmentation";
import {
  isAcceptedFile,
  loadRasterLayerPreviews,
  toWorkspaceLayers,
} from "./workspaceDocument";

type UploadResult = Awaited<
  ReturnType<typeof createAndUploadSource>
>;

interface WorkspaceUploadOptions {
  mode: ProjectMode;
  authenticated: boolean;
  persistedSource: boolean;
  sourceName: string;
  projectId?: string;
  pdfMode: PdfSegmentation;
  onRequireAuth: () => void;
  onNotify: (message: string) => void;
  onLayerAssetUrls: (urls: string[]) => void;
  onDocumentReady: (
    file: File,
    result: UploadResult,
    layers: Layer[],
  ) => void;
  setSourceName: Dispatch<SetStateAction<string>>;
  setUploadState: Dispatch<SetStateAction<UploadState>>;
  setUploadProgress: Dispatch<SetStateAction<number>>;
  setUploadError: Dispatch<SetStateAction<string | undefined>>;
  setUploadDetailsOpen: Dispatch<SetStateAction<boolean>>;
}

function fileValidationError(
  file: File,
  mode: ProjectMode,
): string | undefined {
  if (file.size === 0) {
    return "الملف فارغ. اختر ملفًا يحتوي على بيانات.";
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return `حجم ${file.name} أكبر من ${MAX_UPLOAD_MEBIBYTES} MiB. اختر ملفًا أصغر ثم أعد المحاولة.`;
  }
  if (!isAcceptedFile(file, mode)) {
    return mode === "image"
      ? "الصيغة غير مدعومة. استخدم PNG أو JPG أو WebP أو AVIF أو TIFF أو BMP."
      : "هذه العملية تقبل ملف PDF واحدًا فقط.";
  }
  return undefined;
}

function uploadSuccessMessage(
  mode: ProjectMode,
  result: UploadResult,
): string {
  const preparation = result.document.imagePreparation;
  if (
    mode === "image" &&
    preparation?.strategy === "alpha-components"
  ) {
    return preparation.overflowMerged
      ? `استُخرجت ${preparation.outputLayers} طبقة Raster من ${preparation.detectedComponents} مكوّنًا؛ جُمّع الفائض في طبقة مراجعة واحدة.`
      : `استُخرجت ${preparation.outputLayers} طبقات Raster مستقلة وحُفظت أصولها.`;
  }
  return mode === "image"
    ? "حُفظت الصورة كطبقة Raster واحدة؛ لا توجد مكوّنات شفافة منفصلة آمنة للفصل."
    : "تم رفع المصدر والتحقق من نوعه وبصمته على الخادم.";
}

export function useWorkspaceUpload(options: WorkspaceUploadOptions) {
  const uploadAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      uploadAbortRef.current?.abort();
    },
    [],
  );

  const chooseSource = async (file?: File): Promise<void> => {
    if (!file) return;
    if (!options.authenticated) {
      options.onNotify("سجّل الدخول أولًا لرفع الملفات وحمايتها.");
      options.onRequireAuth();
      return;
    }
    const validationError = fileValidationError(file, options.mode);
    if (validationError) {
      options.setUploadState("error");
      options.setUploadError(validationError);
      options.setUploadProgress(0);
      options.setUploadDetailsOpen(true);
      return;
    }
    if (
      options.persistedSource &&
      !window.confirm(
        `سيُحفظ ${options.sourceName} كنسخة سابقة، ويصبح ${file.name} مصدرًا جديدًا. هل تريد المتابعة؟`,
      )
    ) {
      return;
    }

    const previousSourceName = options.sourceName;
    options.setSourceName(file.name);
    options.setUploadError(undefined);
    options.setUploadProgress(0);
    options.setUploadState("validating");
    options.setUploadDetailsOpen(true);
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    try {
      options.setUploadState("uploading");
      const result = await createAndUploadSource(
        file,
        options.mode,
        {
          signal: controller.signal,
          ...(options.projectId
            ? { projectId: options.projectId }
            : {}),
          onUploadProgress: (progress) => {
            options.setUploadState("uploading");
            options.setUploadProgress(Math.round(progress * 0.65));
          },
          onProcessingProgress: (progress) => {
            options.setUploadState("verifying");
            options.setUploadProgress(
              65 + Math.round(progress * 0.33),
            );
          },
          ...(options.mode === "book"
            ? {
                pdfSeparationMode:
                  pdfApiModes[options.pdfMode],
              }
            : {}),
        },
      );
      options.setUploadState("verifying");
      options.setUploadProgress(99);
      const previewResult =
        options.mode === "image"
          ? await loadRasterLayerPreviews(
              result.projectId,
              result.sourceVersionId,
              result.document,
              controller.signal,
            )
          : { previews: new Map<string, string>(), urls: [] };
      options.onLayerAssetUrls(previewResult.urls);
      options.onDocumentReady(
        file,
        result,
        toWorkspaceLayers(
          result.document,
          options.mode,
          previewResult.previews,
        ),
      );
      options.setUploadProgress(100);
      options.setUploadState("ready");
      options.setUploadDetailsOpen(false);
      options.onNotify(uploadSuccessMessage(options.mode, result));
    } catch (error) {
      if (controller.signal.aborted) {
        options.setSourceName(previousSourceName);
        return;
      }
      options.setUploadState("error");
      options.setUploadProgress(0);
      options.setUploadError(
        error instanceof ApiError
          ? error.message
          : "تعذر رفع الملف. تحقق من تشغيل API ثم أعد المحاولة.",
      );
    } finally {
      if (uploadAbortRef.current === controller) {
        uploadAbortRef.current = null;
      }
    }
  };

  const cancelUpload = () => {
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    options.setUploadState(
      options.persistedSource ? "ready" : "empty",
    );
    options.setUploadProgress(
      options.persistedSource ? 100 : 0,
    );
    options.setUploadDetailsOpen(false);
    options.onNotify(
      "أُلغيت العملية وبقيت نسخة المصدر الحالية كما هي.",
    );
  };

  return { chooseSource, cancelUpload };
}
