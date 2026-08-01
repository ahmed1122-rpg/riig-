export function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const timeout = setTimeout(done, milliseconds);
    timeout.unref();
    signal?.addEventListener("abort", done, { once: true });
  });
}
