import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));

export async function verifyWorkerBuildContract(repositoryRoot = defaultRoot) {
  const violations = [];
  const appsDirectory = path.join(repositoryRoot, "apps");
  const workerNames = (await readdir(appsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("worker-"))
    .map((entry) => entry.name)
    .sort();

  for (const workerName of workerNames) {
    const workerDirectory = path.join(appsDirectory, workerName);
    const packageManifest = JSON.parse(
      await readFile(path.join(workerDirectory, "package.json"), "utf8"),
    );
    if (packageManifest.scripts?.build !== "tsc -p tsconfig.build.json") {
      violations.push(
        `${workerName} must build with tsconfig.build.json so tests cannot enter the runtime image.`,
      );
      continue;
    }
    const buildConfig = JSON.parse(
      await readFile(path.join(workerDirectory, "tsconfig.build.json"), "utf8"),
    );
    if (buildConfig.extends !== "./tsconfig.json") {
      violations.push(`${workerName} build config must extend its checked typecheck config.`);
    }
    if (!buildConfig.exclude?.includes("src/**/*.test.ts")) {
      violations.push(`${workerName} build config must exclude src/**/*.test.ts.`);
    }
  }

  return violations;
}

async function main() {
  const violations = await verifyWorkerBuildContract();
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Worker production build contract verified.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
