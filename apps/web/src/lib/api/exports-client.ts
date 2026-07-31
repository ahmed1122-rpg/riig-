import { API_ORIGIN, ApiError, request } from "./transport";
import { waitForJob } from "./job-polling";
import type { ExportSummary } from "./models";

export function listExports(): Promise<ExportSummary[]> {
  return request<ExportSummary[]>("/v1/exports");
}

export function cancelExport(exportId: string): Promise<ExportSummary> {
  return request<ExportSummary>(
    `/v1/exports/${encodeURIComponent(exportId)}/cancel`,
    { method: "POST" },
  );
}

export function downloadExport(exportId: string): void {
  const anchor = document.createElement("a");
  anchor.href = `${API_ORIGIN}/v1/exports/${encodeURIComponent(exportId)}/download`;
  anchor.download = "motionprep-export.zip";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export async function createExportArtifact(
  projectId: string,
  sourceVersionId: string,
  documentRevision: number,
  format:
    | "psd"
    | "png-layers-json"
    | "layered-tiff"
    | "transparent-pngs"
    | "txt"
    | "csv"
    | "json",
  options: {
    scope?: "full-document" | "per-page" | "selected-page";
    selectedPage?: number;
    signal?: AbortSignal;
    onProgress?: (progress: number) => void;
  } = {},
): Promise<void> {
  const job = await request<Pick<
    ExportSummary,
    "id" | "status" | "progress" | "errorCode"
  >>("/v1/exports", {
    method: "POST",
    signal: options.signal,
    headers: { "x-idempotency-key": crypto.randomUUID() },
    body: JSON.stringify({
      projectId,
      sourceVersionId,
      documentRevision,
      format,
      scope: options.scope ?? "full-document",
      ...(options.selectedPage === undefined
        ? {}
        : { selectedPage: options.selectedPage }),
      scale: 1,
      colorProfile: "sRGB",
      namingPresetId: "adobe-plus",
    }),
  });
  const completed = await waitForJob({
    initial: job,
    load: () =>
      request<typeof job>(
        `/v1/exports/${encodeURIComponent(job.id)}`,
        { signal: options.signal },
      ),
    isComplete: (current) => current.status === "ready",
    failure: (current) =>
      current.status === "failed" || current.status === "cancelled"
        ? new ApiError(
            current.errorCode ?? `EXPORT_${current.status.toUpperCase()}`,
            current.status === "cancelled"
              ? "أُلغيت مهمة التصدير."
              : "تعذر إنشاء ملف التصدير بعد محاولات المعالجة.",
            422,
          )
        : undefined,
    timeoutMs: 10 * 60_000,
    timeoutCode: "EXPORT_TIMEOUT",
    timeoutMessage:
      "يستمر التصدير في الخلفية. ستجده في صفحة التصديرات عند اكتماله.",
    initialIntervalMs: 1_000,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.onProgress ? { onProgress: options.onProgress } : {}),
  });
  downloadExport(completed.id);
}
