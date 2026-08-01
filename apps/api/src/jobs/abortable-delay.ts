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
    // This delay drives the export worker's long-running polling loop. It must
    // keep the process alive even when a dependency outage closes every socket.
    signal?.addEventListener("abort", done, { once: true });
  });
}
