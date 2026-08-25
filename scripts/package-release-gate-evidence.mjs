import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function packageReleaseGateEvidence(outputDirectory, filenames) {
  const output = resolve(outputDirectory);
  const names = filenames.map((filename) => basename(filename));
  if (filenames.length === 0 || new Set(names).size !== names.length) {
    throw new Error("Release gate evidence requires unique source basenames.");
  }
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length > 0) {
    throw new Error("Release gate evidence output directory must be empty.");
  }
  const files = [];
  for (let index = 0; index < filenames.length; index += 1) {
    const source = resolve(filenames[index]);
    const content = await readFile(source);
    const name = names[index];
    await copyFile(source, join(output, name));
    files.push({
      name,
      bytes: content.byteLength,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  files.sort((left, right) => left.name.localeCompare(right.name));
  const manifest = { schemaVersion: 1, files };
  await writeFile(
    join(output, "artifact-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return manifest;
}

export async function verifyReleaseGateEvidence(directory, requiredNames) {
  const root = resolve(directory);
  const manifest = JSON.parse(
    await readFile(join(root, "artifact-manifest.json"), "utf8"),
  );
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error("Release gate artifact manifest must use schemaVersion 1.");
  }
  const expected = [...requiredNames].sort();
  const actual = manifest.files.map((entry) => entry.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Release gate artifact files do not match the required layout.");
  }
  const directoryEntries = (await readdir(root)).sort();
  const expectedEntries = ["artifact-manifest.json", ...expected].sort();
  if (JSON.stringify(directoryEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error("Release gate artifact directory contains unexpected files.");
  }
  for (const entry of manifest.files) {
    if (
      typeof entry.name !== "string" ||
      basename(entry.name) !== entry.name ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      !/^[a-f0-9]{64}$/u.test(entry.sha256 ?? "")
    ) {
      throw new Error("Release gate artifact manifest contains invalid metadata.");
    }
    const content = await readFile(join(root, entry.name));
    const digest = createHash("sha256").update(content).digest("hex");
    if (content.byteLength !== entry.bytes || digest !== entry.sha256) {
      throw new Error(`Release gate artifact ${entry.name} failed integrity verification.`);
    }
  }
  return manifest;
}

async function main() {
  const [outputDirectory, ...filenames] = process.argv.slice(2);
  if (!outputDirectory || filenames.length === 0) {
    throw new Error(
      "Usage: node scripts/package-release-gate-evidence.mjs <output-directory> <file>...",
    );
  }
  await packageReleaseGateEvidence(outputDirectory, filenames);
  process.stdout.write(`Release gate evidence packaged in ${outputDirectory}.\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
