import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isOcrReleaseEvidenceCurrent,
  validateProductionEnvironment,
} from "./verify-release-environment.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const allowedCommands = new Set(["config", "pull", "up", "ps", "run"]);
const allowedProfiles = new Set(["character-rig", "maintenance"]);
const serviceEnvironmentVariables = [
  "MOTIONPREP_MIGRATION_ENV_FILE",
  "MOTIONPREP_API_ENV_FILE",
  "MOTIONPREP_MAINTENANCE_ENV_FILE",
  "MOTIONPREP_MEDIA_WORKER_ENV_FILE",
  "MOTIONPREP_DOCUMENT_WORKER_ENV_FILE",
  "MOTIONPREP_EXPORT_WORKER_ENV_FILE",
  "MOTIONPREP_CHARACTER_WORKER_ENV_FILE",
];

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

export function resolveServiceEnvironmentPaths(controlFile, source) {
  const values = parseEnvironment(source);
  const paths = new Map();
  for (const variable of serviceEnvironmentVariables) {
    const filename = values.get(variable)?.trim();
    if (!filename) throw new Error(`${variable} is required.`);
    paths.set(variable, resolve(dirname(controlFile), filename));
  }
  if (new Set(paths.values()).size !== paths.size) {
    throw new Error("Every production workload must use a distinct environment file.");
  }
  return paths;
}

export function validateServiceEnvironmentIsolation(sources) {
  const violations = [];
  const values = new Map(
    [...sources].map(([name, source]) => [name, parseEnvironment(source)]),
  );
  const migration = values.get("MOTIONPREP_MIGRATION_ENV_FILE");
  if (!migration?.get("MIGRATION_DATABASE_URL")) {
    violations.push("The migration environment must define MIGRATION_DATABASE_URL.");
  }
  const api = values.get("MOTIONPREP_API_ENV_FILE");
  if (api?.has("MIGRATION_DATABASE_URL")) {
    violations.push("The API environment cannot receive MIGRATION_DATABASE_URL.");
  }
  if (api?.get("CHARACTER_INFERENCE_API_KEY")?.trim()) {
    violations.push("The API environment cannot receive the Character provider secret.");
  }

  const forbiddenWorkerSecrets = [
    "AUTH_ENCRYPTION_KEY",
    "SMTP_PASSWORD",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ];
  for (const [name, environment] of values) {
    const isNonApiRuntime = name !== "MOTIONPREP_API_ENV_FILE";
    if (isNonApiRuntime) {
      for (const secret of forbiddenWorkerSecrets) {
        if (environment.get(secret)?.trim()) {
          violations.push(`${name} cannot receive API-only secret ${secret}.`);
        }
      }
    }
    if (
      name !== "MOTIONPREP_CHARACTER_WORKER_ENV_FILE" &&
      environment.get("CHARACTER_INFERENCE_API_KEY")?.trim()
    ) {
      violations.push(`${name} cannot receive the Character provider secret.`);
    }
  }

  const identities = new Map();
  const databaseRoles = new Map();
  for (const [name, environment] of values) {
    const identity = environment.get("MOTIONPREP_WORKLOAD_IDENTITY")?.trim();
    if (!identity) {
      violations.push(`${name} must declare MOTIONPREP_WORKLOAD_IDENTITY.`);
    } else if (identities.has(identity)) {
      violations.push(`${name} reuses workload identity ${identity}.`);
    } else {
      identities.set(identity, name);
    }
    const databaseUrl = environment.get(
      name === "MOTIONPREP_MIGRATION_ENV_FILE"
        ? "MIGRATION_DATABASE_URL"
        : "DATABASE_URL",
    );
    if (!databaseUrl) continue;
    try {
      const role = new URL(databaseUrl).username;
      if (!role) {
        violations.push(`${name} must identify an explicit database role.`);
      } else if (databaseRoles.has(role)) {
        violations.push(`${name} reuses database role ${role}.`);
      } else {
        databaseRoles.set(role, name);
      }
    } catch {
      violations.push(`${name} contains an invalid database URL.`);
    }
  }
  const storageIdentities = new Map();
  for (const [name, environment] of values) {
    const accessKey = environment.get("OBJECT_STORAGE_ACCESS_KEY")?.trim();
    if (!accessKey) continue;
    if (storageIdentities.has(accessKey)) {
      violations.push(`${name} reuses an explicit object-storage identity.`);
    } else {
      storageIdentities.set(accessKey, name);
    }
  }
  return violations;
}

async function main() {
  const invocation = buildProductionComposeInvocation(process.argv.slice(2));
  const environmentSource = await readFile(invocation.environmentFile, "utf8");
  const servicePaths = resolveServiceEnvironmentPaths(
    invocation.environmentFile,
    environmentSource,
  );
  const serviceSources = new Map(
    await Promise.all(
      [...servicePaths].map(async ([name, filename]) => [
        name,
        await readFile(filename, "utf8"),
      ]),
    ),
  );
  const apiEnvironment = serviceSources.get("MOTIONPREP_API_ENV_FILE") ?? "";
  const ocrEvidenceCurrent = await isOcrReleaseEvidenceCurrent(repositoryRoot);
  const violations = validateProductionEnvironment(
    `${environmentSource}\n${apiEnvironment}`,
    {
    ocrEvidenceCurrent,
    },
  );
  violations.push(...validateServiceEnvironmentIsolation(serviceSources));
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }

  const result = spawnSync("docker", invocation.composeArguments, {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      ...Object.fromEntries(servicePaths),
    },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

function parseEnvironment(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  return values;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
