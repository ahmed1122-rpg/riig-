export function uploadLimitLabel(maxUploadBytes: number): string {
  if (!Number.isFinite(maxUploadBytes) || maxUploadBytes <= 0) {
    return "غير متاح";
  }
  const mebibytes = Number((maxUploadBytes / 1024 / 1024).toFixed(2));
  return `${mebibytes} MiB`;
}
