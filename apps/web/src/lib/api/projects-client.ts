import { ApiError, request } from "./transport";
import { waitForJob } from "./job-polling";
import { getProjectLayerDocument } from "./layer-document-client";
import { listSourceVersions } from "./source-versions-client";
import type {
  LayerDocumentView,
  ProcessingSummary,
  ProjectSummary,
  UploadResult,
} from "./models";
import {
  cancelUploadSession,
  isAbortError,
  sourceContentType,
  uploadSourceFile,
  waitForMalwareScan,
} from "./project-upload-transport";

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
  runLayerDocumentCommand,
  splitPdfTextLayer,
  updateLayerDocument,
} from "./layer-document-client";
export {
  listSourceVersionRestores,
  listSourceVersions,
  restoreSourceVersion,
} from "./source-versions-client";
export { getLayerRasterAsset, runPdfRegionOcr } from "./project-assets-client";

export function listProjects(signal?: AbortSignal): Promise<ProjectSummary[]> {
  return request<ProjectSummary[]>("/v1/projects", { signal });
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
  signal?: AbortSignal,
): Promise<ProjectSummary> {
  return request<ProjectSummary>(
    `/v1/projects/${encodeURIComponent(projectId)}/review/approve`,
    {
      method: "POST",
      signal,
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ sourceVersionId, documentRevision }),
    },
  );
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
    const received = await uploadSourceFile(
      intent.uploadUrl,
      file,
      contentType,
      signal,
      options.onUploadProgress,
    );
    const uploaded = await waitForMalwareScan(
      intent.uploadId,
      received,
      signal,
    );
    const sourceVersionId = uploaded.sourceVersionId!;
    const sha256 = uploaded.sha256!;
    options.onLifecycleUpdate?.({
      projectId: project.id,
      uploadId: intent.uploadId,
      sourceVersionId,
    });
    const processing = await request<ProcessingProgress>("/v1/processing/jobs", {
      method: "POST",
      signal,
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        projectId: project.id,
        sourceVersionId,
        ...(mode === "book"
          ? { pdfSeparationMode: options.pdfSeparationMode ?? "sentence" }
          : {}),
      }),
    });
    options.onLifecycleUpdate?.({
      projectId: project.id,
      uploadId: intent.uploadId,
      sourceVersionId,
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
        `/v1/projects/${project.id}/layer-document?sourceVersionId=${sourceVersionId}`,
        { signal },
      ),
      listSourceVersions(project.id, signal),
    ]);
    const sourceVersion = versions.find(
      (version) => version.id === sourceVersionId,
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
      sourceVersionId,
      sourceVersionNumber: sourceVersion.versionNumber,
      sha256,
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
