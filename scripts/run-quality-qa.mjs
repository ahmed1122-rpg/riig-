import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
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
  const npmCliPath = resolveNpmCliPath();
  await access(npmCliPath);
  exitCode = await run(process.execPath, [npmCliPath, "run", "quality"]);
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

function resolveNpmCliPath() {
  if (process.env.npm_execpath) {
    return process.env.npm_execpath;
  }
  if (process.platform === "win32") {
    return path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
  }
  return path.join(
    path.dirname(path.dirname(process.execPath)),
    "lib",
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
}
