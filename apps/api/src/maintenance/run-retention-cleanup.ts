import { createRetentionRuntime } from "./retention-runtime.js";

const runtime = createRetentionRuntime();

try {
  await runtime.ready();
  const report = await runtime.runner.run();
  process.stdout.write(`${JSON.stringify(report ?? { skipped: "locked" })}\n`);
  if (report && report.failures.length > 0) process.exitCode = 1;
} finally {
  await runtime.close();
}
