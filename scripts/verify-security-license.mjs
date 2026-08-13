import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function verifySecurityAndLicense(repositoryRoot = root) {
  const violations = [];
  const [manifest, license, notice, security] = await Promise.all([
    readJson(join(repositoryRoot, "package.json")),
    readFile(join(repositoryRoot, "LICENSE"), "utf8"),
    readFile(join(repositoryRoot, "NOTICE"), "utf8"),
    readFile(join(repositoryRoot, "SECURITY.md"), "utf8"),
  ]);
  if (manifest.license !== "UNLICENSED" || manifest.private !== true) {
    violations.push("The root package must remain private and UNLICENSED.");
  }
  if (!license.includes("MotionPrep Studio Proprietary License")) {
    violations.push("LICENSE must contain the proprietary product grant boundary.");
  }
  if (!notice.includes("See LICENSE") || !notice.includes("Lucide")) {
    violations.push("NOTICE must reference the product license and bundled icon notice.");
  }
  for (const token of [
    "security/advisories/new",
    "three business days",
    "Do not report vulnerabilities in public issues",
  ]) {
    if (!security.includes(token)) {
      violations.push(`SECURITY.md is missing disclosure token: ${token}`);
    }
  }
  for (const parent of ["apps", "packages"]) {
    for (const entry of await readdir(join(repositoryRoot, parent), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory()) continue;
      const workspace = await readJson(
        join(repositoryRoot, parent, entry.name, "package.json"),
      );
      if (workspace.private !== true || workspace.license !== "UNLICENSED") {
        violations.push(`${parent}/${entry.name} must be private and UNLICENSED.`);
      }
    }
  }
  return violations;
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

async function main() {
  const violations = await verifySecurityAndLicense();
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write("Security disclosure and proprietary license verified.\n");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
