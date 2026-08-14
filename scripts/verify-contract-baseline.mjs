import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const DEFAULT_BASELINE = "config/contract-baseline.json";
const HTTP_METHODS = ["delete", "get", "head", "options", "patch", "post", "put"];

export async function collectContractSnapshot(workspace) {
  const manifests = await collectManifests(workspace);
  const rootManifest = manifests.find(({ file }) => file === "package.json");
  if (!rootManifest) throw new Error("The root package.json was not discovered.");

  const openApiOperations = await collectOpenApiOperations(workspace);
  const migrations = await collectMigrationChecksums(workspace);
  const dockerTargets = await collectDockerTargets(workspace);
  const composeServices = await collectComposeServices(workspace);
  const featureFlags = await collectFeatureFlags(workspace);
  const knip = JSON.parse(
    await readFile(path.join(workspace, "knip.json"), "utf8"),
  );

  const workspaceScripts = {};
  const packageExports = {};
  const workerEntrypoints = {};
  for (const { file, manifest } of manifests) {
    if (file === "package.json") continue;
    const name = requiredString(manifest.name, `${file} name`);
    workspaceScripts[name] = sortedKeys(manifest.scripts ?? {});
    if (manifest.exports) packageExports[name] = normalize(manifest.exports);
    if (name.startsWith("@motionprep/worker-")) {
      const directory = path.posix.dirname(file);
      workerEntrypoints[name] = {
        source: `${directory}/src/index.ts`,
        development: manifest.scripts?.dev ?? null,
        production: manifest.scripts?.start ?? null,
      };
    }
  }

  return normalize({
    schemaVersion: 1,
    openApiOperations,
    rootScripts: sortedKeys(rootManifest.manifest.scripts ?? {}),
    workspaceScripts,
    packageExports,
    workerEntrypoints,
    dockerTargets,
    composeServices,
    featureFlags,
    migrations,
    dynamicEntrypoints: {
      knipIgnoredPatterns: [...(knip.ignore ?? [])].sort(compareStrings),
      apiPackageExports: sortedKeys(
        manifests.find(({ manifest }) => manifest.name === "@motionprep/api")
          ?.manifest.exports ?? {},
      ),
    },
  });
}

export function findContractDrift(actual, expected) {
  const differences = [];
  compareValues(actual, expected, "$", differences);
  return differences;
}

async function collectManifests(workspace) {
  const files = ["package.json"];
  for (const root of ["apps", "packages"]) {
    const entries = await readdir(path.join(workspace, root), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isDirectory()) files.push(`${root}/${entry.name}/package.json`);
    }
  }
  files.sort(compareStrings);
  return Promise.all(
    files.map(async (file) => ({
      file,
      manifest: JSON.parse(await readFile(path.join(workspace, file), "utf8")),
    })),
  );
}

async function collectOpenApiOperations(workspace) {
  const appModule = await import(
    pathToFileURL(path.join(workspace, "apps/api/src/app.ts")).href
  );
  const configModule = await import(
    pathToFileURL(path.join(workspace, "apps/api/src/config.ts")).href
  );
  const app = await appModule.buildApp(configModule.loadConfig({ NODE_ENV: "test" }));
  try {
    await app.ready();
    const document = app.swagger();
    const operations = [];
    for (const [route, item] of Object.entries(document.paths ?? {})) {
      for (const method of HTTP_METHODS) {
        if (item?.[method]) operations.push(`${method.toUpperCase()} ${route}`);
      }
    }
    return operations.sort(compareStrings);
  } finally {
    await app.close();
  }
}

async function collectMigrationChecksums(workspace) {
  const directory = path.join(workspace, "apps/api/migrations");
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort(compareStrings);
  const checksums = {};
  for (const file of files) {
    const sql = await readFile(path.join(directory, file), "utf8");
    checksums[file] = createHash("sha256").update(sql, "utf8").digest("hex");
  }
  return checksums;
}

async function collectDockerTargets(workspace) {
  const result = {};
  for (const file of ["Dockerfile", "Dockerfile.qa", "Dockerfile.web"]) {
    const source = await readFile(path.join(workspace, file), "utf8");
    result[file] = [...source.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?\s*$/gimu)].map(
      (match, index) => ({
        base: match[1],
        target: match[2] ?? `<final-${index + 1}>`,
      }),
    );
  }
  return result;
}

async function collectComposeServices(workspace) {
  const result = {};
  for (const file of [
    "compose.yaml",
    "compose.integration.yaml",
    "compose.production.yaml",
  ]) {
    const document = parse(await readFile(path.join(workspace, file), "utf8"));
    result[file] = Object.fromEntries(
      Object.entries(document?.services ?? {})
        .sort(([left], [right]) => compareStrings(left, right))
        .map(([name, service]) => [
          name,
          [...(service?.profiles ?? [])].sort(compareStrings),
        ]),
    );
  }
  return result;
}

async function collectFeatureFlags(workspace) {
  const source = await readFile(
    path.join(workspace, "apps/api/src/config.ts"),
    "utf8",
  );
  const flags = {};
  for (const match of source.matchAll(
    /^\s{4}([A-Z][A-Z0-9_]*_ENABLED):\s+z[\s\S]{0,220}?\.default\("([^"]+)"\)/gmu,
  )) {
    flags[match[1]] = match[2];
  }
  if (Object.keys(flags).length === 0) {
    throw new Error("No feature flags were discovered in apps/api/src/config.ts.");
  }
  return flags;
}

function compareValues(actual, expected, currentPath, differences) {
  if (isDeepStrictEqual(actual, expected)) return;
  const actualObject = isRecord(actual);
  const expectedObject = isRecord(expected);
  if (actualObject && expectedObject) {
    const keys = new Set([...Object.keys(actual), ...Object.keys(expected)]);
    for (const key of [...keys].sort(compareStrings)) {
      if (!(key in actual)) {
        differences.push(`${currentPath}.${key}: missing from current contract`);
      } else if (!(key in expected)) {
        differences.push(`${currentPath}.${key}: added to current contract`);
      } else {
        compareValues(actual[key], expected[key], `${currentPath}.${key}`, differences);
      }
    }
    return;
  }
  differences.push(
    `${currentPath}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
  );
}

function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, item]) => [key, normalize(item)]),
  );
}

function sortedKeys(value) {
  return Object.keys(value).sort(compareStrings);
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function main() {
  const workspace = process.cwd();
  const actual = await collectContractSnapshot(workspace);
  if (process.argv.includes("--measure")) {
    process.stdout.write(`${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const baselinePath = path.resolve(
    workspace,
    process.env.CONTRACT_BASELINE ?? DEFAULT_BASELINE,
  );
  const expected = JSON.parse(await readFile(baselinePath, "utf8"));
  const differences = findContractDrift(actual, expected);
  if (differences.length > 0) {
    process.stderr.write("Contract baseline drift detected:\n");
    for (const difference of differences) process.stderr.write(`- ${difference}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Contract baseline verified (${actual.openApiOperations.length} API operations, ` +
      `${Object.keys(actual.migrations).length} migrations).\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
