import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isOcrReleaseEvidenceCurrent,
  validateProductionEnvironment,
} from "./verify-release-environment.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const allowedCommands = new Set(["config", "pull", "up", "ps", "run"]);
const allowedProfiles = new Set(["character-rig", "maintenance"]);

export function buildProductionComposeInvocation(arguments_) {
  const [environmentFile, ...remaining] = arguments_;
  if (!environmentFile) {
    throw new Error(
      "Usage: node scripts/run-production-compose.mjs <environment-file> [--profile <name>] <config|pull|up|ps|run> [...arguments]",
    );
  }
  const composeArguments = [
    "compose",
    "--env-file",
    resolve(environmentFile),
    "-f",
    resolve(repositoryRoot, "compose.production.yaml"),
  ];
  if (remaining[0] === "--profile") {
    const profile = remaining.shift();
    const profileName = remaining.shift();
    if (profile !== "--profile" || !profileName || !allowedProfiles.has(profileName)) {
      throw new Error("Production Compose profile is not approved.");
    }
    composeArguments.push("--profile", profileName);
  }
  const command = remaining.shift();
  if (!command || !allowedCommands.has(command)) {
    throw new Error("Production Compose command is not approved.");
  }
  composeArguments.push(command, ...remaining);
  return {
    environmentFile: resolve(environmentFile),
    composeArguments,
  };
}

async function main() {
  const invocation = buildProductionComposeInvocation(process.argv.slice(2));
  const environmentSource = await readFile(invocation.environmentFile, "utf8");
  const ocrEvidenceCurrent = await isOcrReleaseEvidenceCurrent(repositoryRoot);
  const violations = validateProductionEnvironment(environmentSource, {
    ocrEvidenceCurrent,
  });
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }

  const result = spawnSync("docker", invocation.composeArguments, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      MOTIONPREP_ENV_FILE: invocation.environmentFile,
    },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
