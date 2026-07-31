import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const immutableReference = /^.+@sha256:[a-f0-9]{64}$/u;

export function validateReleaseEnvironment(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const violations = [];
  for (const key of ["RUNTIME_IMAGE_REF", "WEB_IMAGE_REF"]) {
    const value = values.get(key) ?? "";
    if (!immutableReference.test(value)) {
      violations.push(`${key} must be a registry reference pinned by sha256 digest.`);
    }
  }
  for (const forbidden of ["IMAGE_TAG", "RUNTIME_IMAGE", "WEB_IMAGE"]) {
    if (values.has(forbidden)) {
      violations.push(`${forbidden} is unsupported; use digest-qualified *_IMAGE_REF values.`);
    }
  }
  return violations;
}

async function main() {
  const filename = process.argv[2];
  if (!filename) {
    throw new Error(
      "Usage: node scripts/verify-release-environment.mjs <production.env>",
    );
  }
  const violations = validateReleaseEnvironment(
    await readFile(filename, "utf8"),
  );
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Immutable release environment verified.\n");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
