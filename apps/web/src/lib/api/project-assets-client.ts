import type { LayerDocumentView, ProcessingSummary } from "./models";
import { getProjectLayerDocument } from "./layer-document-client";
import { waitForJob } from "./job-polling";
import { API_ORIGIN, ApiError, request, type ApiEnvelope } from "./transport";

type ProcessingProgress = Pick<
  ProcessingSummary,
  "id" | "status" | "progress" | "errorCode"
>;

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
    load: () => request<typeof job>(
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
  return getProjectLayerDocument(projectId, options.signal, input.sourceVersionId);
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
