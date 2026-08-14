import { ExportDomainError } from "./export-errors.js";

export async function runExportWithDeadline<T>(
  run: () => Promise<T>,
  timeoutMilliseconds: number,
  onTimeout: () => void,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<T>((_resolve, reject) => {
    timeout = setTimeout(() => {
      try {
        onTimeout();
      } finally {
        reject(
          new ExportDomainError(
            "EXPORT_DEADLINE_EXCEEDED",
            "تجاوز إنشاء ملف التصدير المهلة التشغيلية الآمنة.",
          ),
        );
      }
    }, timeoutMilliseconds);
    timeout.unref();
  });
  try {
    return await Promise.race([run(), deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
