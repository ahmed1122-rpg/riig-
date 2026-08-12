import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const startedAt = new Date();
const reportPath = path.resolve(
  process.cwd(),
  process.env.QA_REPORT_PATH ?? "artifacts/qa/quality-summary.json",
);
const manifest = JSON.parse(await readFile("package.json", "utf8"));
let exitCode = 1;
let failure = null;

try {
  exitCode = await run("npm", ["run", "quality"]);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
}

const completedAt = new Date();
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(
  reportPath,
  `${JSON.stringify(
    {
      schemaVersion: "1.0",
      command: "npm run quality",
      outcome: exitCode === 0 && failure === null ? "passed" : "failed",
      exitCode,
      failure,
      applicationVersion: manifest.version,
      nodeVersion: process.version,
      npmUserAgent: process.env.npm_config_user_agent ?? null,
      gitSha: process.env.GITHUB_SHA ?? null,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
process.stdout.write(`QA summary written to ${reportPath}.\n`);
process.exitCode = exitCode === 0 && failure === null ? 0 : exitCode || 1;

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${command} terminated by ${signal}.`));
        return;
      }
      resolve(code ?? 1);
    });
  });
}
