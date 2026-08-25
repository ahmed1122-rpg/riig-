import type { UploadSession } from "@motionprep/contracts";
import { waitForJob } from "./job-polling";
import {
  API_ORIGIN,
  ApiError,
  request,
  type ApiEnvelope,
} from "./transport";

const scanFailureMessage = "تعذر إكمال تجهيز الملف.";

export function sourceContentType(file: File): string {
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

export function uploadSourceFile(
  uploadUrl: string,
  file: File,
  contentType: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<UploadSession> {
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
      let payload: ApiEnvelope<UploadSession>;
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

export async function waitForMalwareScan(
  uploadId: string,
  initial: UploadSession,
  signal?: AbortSignal,
): Promise<UploadSession> {
  return waitForJob({
    initial,
    load: async () =>
      request<UploadSession>(`/v1/uploads/${encodeURIComponent(uploadId)}`, {
        signal,
      }),
    isComplete: (session) => session.status === "ready",
    failure: uploadScanFailure,
    timeoutMs: 3 * 60_000,
    timeoutCode: "MALWARE_SCAN_TIMEOUT",
    timeoutMessage: scanFailureMessage,
    initialIntervalMs: 500,
    maximumIntervalMs: 3_000,
    ...(signal ? { signal } : {}),
  });
}

export async function cancelUploadSession(uploadId: string): Promise<void> {
  try {
    await request(`/v1/uploads/${encodeURIComponent(uploadId)}/cancel`, {
      method: "POST",
      timeoutMs: 5_000,
    });
  } catch {
    // The upload may have completed just before the abort signal won.
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function uploadScanFailure(session: UploadSession): ApiError | undefined {
  if (session.status === "rejected") {
    return new ApiError("MALWARE_DETECTED", "الملف ضار. اختر ملفًا آخر.", 422);
  }
  if (session.status === "scan_failed") {
    return new ApiError(
      "MALWARE_SCAN_FAILED",
      scanFailureMessage,
      503,
      undefined,
      true,
    );
  }
  if (session.status === "failed" || session.status === "cancelled") {
    return new ApiError(
      session.status === "cancelled" ? "UPLOAD_CANCELLED" : "UPLOAD_FAILED",
      session.status === "cancelled"
        ? "أُلغيت عملية رفع الملف."
        : "تعذر إكمال رفع الملف.",
      409,
    );
  }
  return undefined;
}
