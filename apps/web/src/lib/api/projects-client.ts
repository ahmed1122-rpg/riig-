import {
  API_ORIGIN,
  ApiError,
  request,
  type ApiEnvelope,
} from "./transport";
import { waitForJob } from "./job-polling";
import { getProjectLayerDocument } from "./layer-document-client";
import { listSourceVersions } from "./source-versions-client";
import type {
  LayerDocumentView,
  ProcessingSummary,
  ProjectSummary,
  UploadResult,
} from "./models";

type ProcessingProgress = Pick<
  ProcessingSummary,
  "id" | "status" | "progress" | "errorCode"
>;

export {
  applyGuidedRefinement,
  getProjectLayerDocument,
  mergeImageLayers,
  mergePdfTextLayers,
  navigateLayerDocumentHistory,
  refineImageLayerEdges,
  splitPdfTextLayer,
  updateLayerDocument,
} from "./layer-document-client";
export {
  listSourceVersionRestores,
  listSourceVersions,
  restoreSourceVersion,
} from "./source-versions-client";

export function listProjects(): Promise<ProjectSummary[]> {
  return request<ProjectSummary[]>("/v1/projects");
}

export function getProject(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectSummary> {
  return request<ProjectSummary>(
    `/v1/projects/${encodeURIComponent(projectId)}`,
    { signal },
  );
}

export function deleteEmptyProject(projectId: string): Promise<void> {
  return request<void>(`/v1/projects/${encodeURIComponent(projectId)}`, {
    method: "DELETE",
  });
}

export interface UploadLifecycleUpdate {
  projectId: string;
  uploadId?: string;
  sourceVersionId?: string;
  processingJobId?: string;
}

export function approveProjectReview(
  projectId: string,
  sourceVersionId: string,
  documentRevision: number,
): Promise<ProjectSummary> {
  return request<ProjectSummary>(
    `/v1/projects/${encodeURIComponent(projectId)}/review/approve`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ sourceVersionId, documentRevision }),
    },
  );
}

function sourceContentType(file: File): string {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    avif: "image/avif",
    tif: "image/tiff",
    tiff: "image/tiff",
    bmp: "image/bmp",
    pdf: "application/pdf",
  };
  return byExtension[extension ?? ""] ?? file.type;
}

export async function createAndUploadSource(
  file: File,
  mode: "image" | "book",
  options: {
    signal?: AbortSignal;
    projectId?: string;
    onUploadProgress?: (progress: number) => void;
    onProcessingProgress?: (progress: number) => void;
    onLifecycleUpdate?: (update: UploadLifecycleUpdate) => void;
    pdfSeparationMode?:
      | "heading"
      | "topic"
      | "sentence"
      | "line"
      | "word"
      | "character";
  } = {},
): Promise<UploadResult> {
  const { signal } = options;
  const project = options.projectId
    ? { id: options.projectId }
    : await request<{ id: string }>("/v1/projects", {
        method: "POST",
        signal,
        body: JSON.stringify({
          name: file.name.replace(/\.[^.]+$/, ""),
          kind: mode,
        }),
      });
  options.onLifecycleUpdate?.({ projectId: project.id });
  const contentType = sourceContentType(file);
  const intent = await request<{
    uploadId: string;
    uploadUrl: string;
  }>("/v1/uploads/intents", {
    method: "POST",
    signal,
    headers: { "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      projectId: project.id,
      filename: file.name,
      contentType,
      sizeBytes: file.size,
      replaceSourceVersion: Boolean(options.projectId),
    }),
  });
  options.onLifecycleUpdate?.({
    projectId: project.id,
    uploadId: intent.uploadId,
  });
  try {
    const uploaded = await uploadSourceFile(
      intent.uploadUrl,
      file,
      contentType,
      signal,
      options.onUploadProgress,
    );
  options.onLifecycleUpdate?.({
    projectId: project.id,
    uploadId: intent.uploadId,
    sourceVersionId: uploaded.sourceVersionId,
  });
  const processing = await request<ProcessingProgress>("/v1/processing/jobs", {
    method: "POST",
    signal,
    headers: { "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      projectId: project.id,
      sourceVersionId: uploaded.sourceVersionId,
      ...(mode === "book"
        ? { pdfSeparationMode: options.pdfSeparationMode ?? "sentence" }
        : {}),
    }),
  });
  options.onLifecycleUpdate?.({
    projectId: project.id,
    uploadId: intent.uploadId,
    sourceVersionId: uploaded.sourceVersionId,
    processingJobId: processing.id,
  });
  await waitForJob({
    initial: processing,
    load: () =>
      request<typeof processing>(
        `/v1/processing/jobs/${encodeURIComponent(processing.id)}`,
        { signal },
      ),
    isComplete: (job) => job.status === "ready",
    failure: processingFailure,
    timeoutMs: 2 * 60_000,
    timeoutCode: "PROCESSING_TIMEOUT",
    timeoutMessage:
      "استغرقت المعالجة وقتًا أطول من المتوقع. ستظل المهمة محفوظة ويمكن متابعتها لاحقًا.",
    ...(signal ? { signal } : {}),
    ...(options.onProcessingProgress
      ? { onProgress: options.onProcessingProgress }
      : {}),
  });
  const [document, versions] = await Promise.all([
    request<LayerDocumentView>(
      `/v1/projects/${project.id}/layer-document?sourceVersionId=${uploaded.sourceVersionId}`,
      { signal },
    ),
    listSourceVersions(project.id, signal),
  ]);
  const sourceVersion = versions.find(
    (version) => version.id === uploaded.sourceVersionId,
  );
  if (!sourceVersion) {
    throw new ApiError(
      "SOURCE_VERSION_NOT_FOUND",
      "تعذر تحديد رقم إصدار المصدر بعد اكتمال الرفع.",
      409,
    );
  }
  return {
    projectId: project.id,
    sourceVersionId: uploaded.sourceVersionId,
    sourceVersionNumber: sourceVersion.versionNumber,
    sha256: uploaded.sha256,
    document,
  };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      await cancelUploadSession(intent.uploadId);
    }
    throw error;
  }
}

export async function reanalyzePdfSource(
  projectId: string,
  sourceVersionId: string,
  separationMode:
    | "heading"
    | "topic"
    | "sentence"
    | "line"
    | "word"
    | "character",
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  } = {},
): Promise<LayerDocumentView> {
  const job = await request<ProcessingProgress>("/v1/processing/jobs", {
    method: "POST",
    signal: options.signal,
    headers: { "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      projectId,
      sourceVersionId,
      pdfSeparationMode: separationMode,
    }),
  });
  await waitForJob({
    initial: job,
    load: () =>
      request<typeof job>(
        `/v1/processing/jobs/${encodeURIComponent(job.id)}`,
        { signal: options.signal },
      ),
    isComplete: (current) => current.status === "ready",
    failure: (current) =>
      current.status === "failed"
        ? new ApiError(
            current.errorCode ?? "PDF_REANALYSIS_FAILED",
            "تعذر إعادة تحليل ملف PDF بنمط التقطيع المحدد.",
            422,
          )
        : undefined,
    timeoutMs: 5 * 60_000,
    timeoutCode: "PDF_REANALYSIS_TIMEOUT",
    timeoutMessage:
      "تستمر إعادة التحليل في الخلفية. أعد فتح المشروع بعد قليل.",
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  return getProjectLayerDocument(
    projectId,
    options.signal,
    sourceVersionId,
  );
}

function uploadSourceFile(
  uploadUrl: string,
  file: File,
  contentType: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<{ sourceVersionId: string; sha256: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal?.removeEventListener("abort", abort);
    xhr.open("PUT", `${API_ORIGIN}${uploadUrl}`);
    xhr.timeout = 5 * 60_000;
    xhr.withCredentials = true;
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.(
        Math.min(100, Math.round((event.loaded / event.total) * 100)),
      );
    });
    xhr.addEventListener("load", () => {
      cleanup();
      let payload: ApiEnvelope<{
        sourceVersionId: string;
        sha256: string;
      }>;
      try {
        payload = JSON.parse(xhr.responseText) as typeof payload;
      } catch {
        reject(
          new ApiError(
            "UPLOAD_RESPONSE_INVALID",
            "تعذر قراءة استجابة خادم الرفع.",
            xhr.status,
          ),
        );
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300 || !payload.data) {
        reject(
          new ApiError(
            payload.error?.code ?? "UPLOAD_FAILED",
            payload.error?.message ?? "تعذر رفع الملف إلى الخادم.",
            xhr.status,
          ),
        );
        return;
      }
      onProgress?.(100);
      resolve(payload.data);
    });
    xhr.addEventListener("error", () => {
      cleanup();
      reject(
        new ApiError(
          "UPLOAD_NETWORK_ERROR",
          "انقطع الاتصال أثناء رفع الملف. أعد المحاولة.",
          0,
        ),
      );
    });
    xhr.addEventListener("timeout", () => {
      cleanup();
      reject(
        new ApiError(
          "UPLOAD_TIMEOUT",
          "انتهت مهلة رفع الملف. تحقق من سرعة الاتصال ثم أعد المحاولة.",
          408,
          undefined,
          true,
        ),
      );
    });
    xhr.addEventListener("abort", () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    });
    if (signal?.aborted) {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    xhr.send(file);
  });
}

async function cancelUploadSession(uploadId: string): Promise<void> {
  try {
    await request(`/v1/uploads/${encodeURIComponent(uploadId)}/cancel`, {
      method: "POST",
      timeoutMs: 5_000,
    });
  } catch {
    // The upload may have completed just before the abort signal won.
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function runPdfRegionOcr(
  projectId: string,
  input: {
    sourceVersionId: string;
    baseRevision: number;
    pageNumber: number;
    start: { x: number; y: number };
    end: { x: number; y: number };
  },
  options: {
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  } = {},
): Promise<LayerDocumentView> {
  const job = await request<ProcessingProgress>(
    `/v1/projects/${encodeURIComponent(projectId)}/layer-document/text/region-ocr`,
    {
      method: "POST",
      signal: options.signal,
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );
  await waitForJob({
    initial: job,
    load: () =>
      request<typeof job>(
        `/v1/processing/jobs/${encodeURIComponent(job.id)}`,
        { signal: options.signal },
      ),
    isComplete: (current) => current.status === "ready",
    failure: (current) =>
      current.status === "failed"
        ? new ApiError(
            current.errorCode ?? "PDF_REGION_OCR_FAILED",
            current.errorCode === "DOCUMENT_REVISION_CONFLICT"
              ? "تغيرت طبقات الصفحة أثناء OCR. أعد تحميل المشروع ثم حاول مجددًا."
              : "تعذر التعرف على النص داخل المنطقة المحددة. جرّب توسيع المنطقة أو اختيار مسح أوضح.",
            current.errorCode === "DOCUMENT_REVISION_CONFLICT" ? 409 : 422,
          )
        : undefined,
    timeoutMs: 5 * 60_000,
    timeoutCode: "PDF_REGION_OCR_TIMEOUT",
    timeoutMessage:
      "يستمر OCR الإقليمي في الخلفية. أعد فتح المشروع بعد قليل لمشاهدة النتيجة.",
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  return getProjectLayerDocument(
    projectId,
    options.signal,
    input.sourceVersionId,
  );
}

export async function getLayerRasterAsset(
  projectId: string,
  sourceVersionId: string,
  layerId: string,
  assetSha256: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const query = new URLSearchParams({ sourceVersionId, assetSha256 });
  const response = await fetch(
    `${API_ORIGIN}/v1/projects/${encodeURIComponent(projectId)}/layers/${encodeURIComponent(layerId)}/asset?${query.toString()}`,
    {
      cache: "force-cache",
      credentials: "include",
      ...(signal ? { signal } : {}),
    },
  );
  if (!response.ok) {
    let error: ApiEnvelope<never>["error"] = null;
    try {
      error = (await response.json() as ApiEnvelope<never>).error;
    } catch {
      // A binary endpoint may return an empty 404 for malformed identifiers.
    }
    throw new ApiError(
      error?.code ?? "LAYER_ASSET_FAILED",
      error?.message ?? "تعذر تحميل أصل طبقة الصورة.",
      response.status,
    );
  }
  return response.blob();
}

function processingFailure(job: {
  status: string;
  errorCode: string | null;
}): ApiError | undefined {
  if (job.status !== "failed" && job.status !== "cancelled") return undefined;
  if (job.errorCode === "OCR_REQUIRED" || job.errorCode === "OCR_FAILED") {
    return new ApiError(
      job.errorCode,
      job.errorCode === "OCR_REQUIRED"
        ? "توجد صفحة ممسوحة بلا نص مضمّن، لكن OCR المحلي غير مفعّل."
        : "تعذر التعرف على النص في إحدى الصفحات المصوّرة. جرّب نسخة أوضح أو استخدم التحديد اليدوي.",
      422,
    );
  }
  return new ApiError(
    job.errorCode ??
      (job.status === "cancelled"
        ? "PROCESSING_CANCELLED"
        : "PROCESSING_FAILED"),
    job.status === "cancelled"
      ? "أُلغيت مهمة تجهيز وثيقة الطبقات."
      : "تعذر تجهيز وثيقة الطبقات.",
    422,
  );
}
