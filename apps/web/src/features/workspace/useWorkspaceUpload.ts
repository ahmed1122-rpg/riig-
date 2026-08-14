import {
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  ApiError,
  createAndUploadSource,
  type UploadLifecycleUpdate,
} from "../../lib/api";
import type { Layer, PdfSegmentation, ProjectMode } from "../../types";
import type { UploadState } from "./SourceUploadStatus";
import { pdfApiModes } from "./pdfSegmentation";
import {
  isAcceptedFile,
  loadRasterLayerPreviews,
  toWorkspaceLayers,
} from "./workspaceDocument";
import { uploadLimitLabel } from "./uploadLimit";
import type { DocumentCommandCoordinator } from "./useDocumentCommandCoordinator";

type UploadResult = Awaited<
  ReturnType<typeof createAndUploadSource>
>;

interface WorkspaceUploadOptions {
  mode: ProjectMode;
  maxUploadBytes: number;
  authenticated: boolean;
  persistedSource: boolean;
  sourceName: string;
  hasUnsavedEditorDraft?: boolean;
  projectId?: string;
  pdfMode: PdfSegmentation;
  commandCoordinator: DocumentCommandCoordinator;
  onRequireAuth: () => void;
  onNotify: (message: string) => void;
  confirmSourceReplacement: (input: {
    title: string;
    description: string;
    confirmLabel: string;
  }) => Promise<boolean>;
  onLayerAssetUrls: (urls: string[]) => void;
  onLifecycleUpdate: (update: UploadLifecycleUpdate) => void;
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
  maxUploadBytes: number,
): string | undefined {
  if (!Number.isFinite(maxUploadBytes) || maxUploadBytes <= 0) {
    return "تعذر التحقق من حد الرفع الحالي. أعد الاتصال بالخادم ثم حاول مجددًا.";
  }
  if (file.size === 0) {
    return "الملف فارغ. اختر ملفًا يحتوي على بيانات.";
  }
  if (file.size > maxUploadBytes) {
    return `حجم ${file.name} أكبر من ${uploadLimitLabel(maxUploadBytes)}. اختر ملفًا أصغر ثم أعد المحاولة.`;
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
  const uploadSequenceRef = useRef(0);
  const previousSourceNameRef = useRef<string | undefined>(undefined);

  useEffect(
    () => () => {
      uploadSequenceRef.current += 1;
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
    const validationError = fileValidationError(
      file,
      options.mode,
      options.maxUploadBytes,
    );
    if (validationError) {
      options.setUploadState("error");
      options.setUploadError(validationError);
      options.setUploadProgress(0);
      options.setUploadDetailsOpen(true);
      return;
    }
    if (
      options.persistedSource &&
      !(await options.confirmSourceReplacement({
        title: "استبدال المصدر الحالي؟",
        description:
          `سيُحفظ ${options.sourceName} كنسخة سابقة، ` +
          `ويصبح ${file.name} مصدرًا جديدًا.` +
          (options.hasUnsavedEditorDraft
            ? " ستُفقد أيضًا مسودة الإرشاد المحلية غير المطبقة."
            : ""),
        confirmLabel: "رفع المصدر الجديد",
      }))
    ) {
      return;
    }

    const previousSourceName =
      previousSourceNameRef.current ?? options.sourceName;
    uploadSequenceRef.current += 1;
    const operationId = uploadSequenceRef.current;
    uploadAbortRef.current?.abort();
    options.setSourceName(file.name);
    options.setUploadError(undefined);
    options.setUploadProgress(0);
    options.setUploadState("validating");
    options.setUploadDetailsOpen(true);
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    previousSourceNameRef.current = previousSourceName;
    const isCurrent = () =>
      uploadSequenceRef.current === operationId &&
      uploadAbortRef.current === controller;
    try {
      await options.commandCoordinator.run(async () => {
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
              if (!isCurrent()) return;
              options.setUploadState("uploading");
              options.setUploadProgress(Math.round(progress * 0.65));
            },
            onProcessingProgress: (progress) => {
              if (!isCurrent()) return;
              options.setUploadState("verifying");
              options.setUploadProgress(
                65 + Math.round(progress * 0.33),
              );
            },
            onLifecycleUpdate: (update) => {
              if (isCurrent()) options.onLifecycleUpdate(update);
            },
            ...(options.mode === "book"
              ? {
                  pdfSeparationMode:
                    pdfApiModes[options.pdfMode],
                }
              : {}),
          },
        );
        if (!isCurrent()) return;
        options.setUploadState("verifying");
        options.setUploadProgress(99);
        const previewResult = options.mode === "image"
          ? await loadRasterLayerPreviews(
              result.projectId,
              result.sourceVersionId,
              result.document,
              controller.signal,
            )
          : { previews: new Map<string, string>(), urls: [] };
        if (!isCurrent()) {
          previewResult.urls.forEach((url) => URL.revokeObjectURL(url));
          return;
        }
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
        previousSourceNameRef.current = undefined;
      }, {
        flush: options.persistedSource,
        allowIdentityChange: true,
      });
    } catch (error) {
      if (!isCurrent()) return;
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
        previousSourceNameRef.current = undefined;
      }
    }
  };

  const cancelUpload = () => {
    uploadSequenceRef.current += 1;
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = null;
    if (previousSourceNameRef.current !== undefined) {
      options.setSourceName(previousSourceNameRef.current);
    }
    previousSourceNameRef.current = undefined;
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
