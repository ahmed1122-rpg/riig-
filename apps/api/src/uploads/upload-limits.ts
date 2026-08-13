import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
  type SourceType,
} from "@motionprep/contracts";

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

export function assertImageUploadLimit(maxImageUploadBytes: number): void {
  if (
    !Number.isSafeInteger(maxImageUploadBytes) ||
    maxImageUploadBytes <= 0 ||
    maxImageUploadBytes > MAX_IMAGE_UPLOAD_BYTES
  ) {
    throw new Error(
      `Image upload limit must be an integer from 1 to ${MAX_IMAGE_UPLOAD_BYTES} bytes.`,
    );
  }
}

export function formatUploadMebibytes(bytes: number): string {
  return Number((bytes / 1024 / 1024).toFixed(2)).toString();
}

export function uploadLimitForSourceType(
  contentType: SourceType,
  maxUploadBytes: number,
  maxImageUploadBytes = MAX_IMAGE_UPLOAD_BYTES,
): number {
  return contentType === "application/pdf"
    ? maxUploadBytes
    : Math.min(maxImageUploadBytes, maxUploadBytes);
}
