import { createRetentionRuntime } from "./retention-runtime.js";
import { runRetentionScheduler } from "./retention-scheduler.js";

const runtime = createRetentionRuntime();
const shutdown = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => shutdown.abort());
}

try {
  await runtime.ready();
  await runRetentionScheduler({
    intervalMilliseconds:
      runtime.config.RETENTION_RUN_INTERVAL_MINUTES * 60_000,
    signal: shutdown.signal,
    run: () => runtime.runner.run(),
    onReport(report) {
      process.stdout.write(
        `${JSON.stringify(report ?? { skipped: "locked" })}\n`,
      );
    },
    onError(error) {
      process.stderr.write(
        `${JSON.stringify({
          event: "retention_cleanup_failed",
          message: error instanceof Error ? error.message : String(error),
        })}\n`,
      );
    },
  });
} finally {
  await runtime.close();
}
