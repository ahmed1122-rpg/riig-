export function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
  schedule?: (milliseconds: number) => Promise<void>,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();

  if (schedule) {
    if (!signal) return schedule(milliseconds);
    return scheduledAbortableDelay(milliseconds, signal, schedule);
  }

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

async function scheduledAbortableDelay(
  milliseconds: number,
  signal: AbortSignal,
  schedule: (milliseconds: number) => Promise<void>,
): Promise<void> {
  let stop: (() => void) | undefined;
  try {
    await Promise.race([
      schedule(milliseconds),
      new Promise<void>((resolve) => {
        stop = resolve;
        signal.addEventListener("abort", stop, { once: true });
      }),
    ]);
  } finally {
    if (stop) signal.removeEventListener("abort", stop);
  }
}
