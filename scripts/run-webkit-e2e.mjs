import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export const WEBKIT_PROJECTS = Object.freeze(["desktop-webkit"]);
const playwrightCli = createRequire(import.meta.url).resolve("@playwright/test/cli");

export function countProjectTests(report, projectName) {
  const visit = (suites) =>
    suites.reduce(
      (count, suite) =>
        count +
        (suite.specs ?? []).filter((spec) =>
          (spec.tests ?? []).some((test) => test.projectName === projectName),
        ).length +
        visit(suite.suites ?? []),
      0,
    );
  return visit(report.suites ?? []);
}

export function isolatedProjectCommands(projectName, testCount, forwardedArguments) {
  return Array.from({ length: testCount }, (_, index) => [
    "test",
    `--project=${projectName}`,
    "--fully-parallel",
    `--shard=${index + 1}/${testCount}`,
    ...forwardedArguments,
  ]);
}

function runPlaywright(arguments_, captureOutput = false) {
  const result = spawnSync(process.execPath, [playwrightCli, ...arguments_], {
    env: process.env,
    encoding: captureOutput ? "utf8" : undefined,
    stdio: captureOutput ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) throw result.error;
  return result;
}

export function runWithFreshProcessRetry(
  arguments_,
  execute,
  onRetry = () => {},
) {
  let result = execute(arguments_);
  if (result.status === 0) return result;
  onRetry(arguments_, result.status ?? 1);
  result = execute(arguments_);
  return result;
}

function exitAfterFailure(result) {
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result;
}

function listProjectTests(projectName, forwardedArguments) {
  const result = exitAfterFailure(runPlaywright([
    "test",
    `--project=${projectName}`,
    ...forwardedArguments,
    "--list",
    "--reporter=json",
  ], true));
  return countProjectTests(JSON.parse(result.stdout ?? ""), projectName);
}

function main() {
  const forwardedArguments = process.argv.slice(2);
  if (forwardedArguments.includes("--list")) {
    exitAfterFailure(runPlaywright([
      "test",
      ...WEBKIT_PROJECTS.map((project) => `--project=${project}`),
      ...forwardedArguments,
    ]));
    return;
  }

  for (const projectName of WEBKIT_PROJECTS) {
    const testCount = listProjectTests(projectName, forwardedArguments);
    if (testCount === 0) {
      throw new Error(`No tests matched the ${projectName} project.`);
    }
    process.stdout.write(
      `Running ${testCount} isolated ${projectName} test${testCount === 1 ? "" : "s"}.\n`,
    );
    for (const command of isolatedProjectCommands(
      projectName,
      testCount,
      forwardedArguments,
    )) {
      const result = runWithFreshProcessRetry(
        command,
        (arguments_) => runPlaywright(arguments_),
        (_arguments, status) => process.stderr.write(
          `WebKit shard exited with status ${status}; retrying once in a fresh Playwright process.\n`,
        ),
      );
      exitAfterFailure(result);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
