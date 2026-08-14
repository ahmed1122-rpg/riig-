export function downloadBlob(
  parts: BlobPart[],
  options: { filename: string; type: string },
): void {
  const objectUrl = URL.createObjectURL(new Blob(parts, { type: options.type }));
  try {
    triggerBrowserDownload(objectUrl, options.filename);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function triggerBrowserDownload(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
  }
}
