import { MAX_UPLOAD_BYTES } from "@motionprep/contracts";

export function assertUploadLimit(maxUploadBytes: number): void {
  if (
    !Number.isSafeInteger(maxUploadBytes) ||
    maxUploadBytes <= 0 ||
    maxUploadBytes > MAX_UPLOAD_BYTES
  ) {
    throw new Error(
      `Upload limit must be an integer from 1 to ${MAX_UPLOAD_BYTES} bytes.`,
    );
  }
}

export function formatUploadMebibytes(bytes: number): string {
  return Number((bytes / 1024 / 1024).toFixed(2)).toString();
}
