import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));

export function findUnusedIconNames(iconModule, consumers) {
  const iconNames = [...iconModule.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):\s*\[/gmu)]
    .map((match) => match[1]);
  return iconNames.filter((iconName) => {
    const literal = new RegExp(
      "[\"'`]" + escapeRegex(iconName) + "[\"'`]",
      "u",
    );
    return !literal.test(consumers);
  });
}

export async function verifyIconUsage(repositoryRoot = defaultRoot) {
  const sourceRoot = path.join(repositoryRoot, "apps/web/src");
  const iconFilename = path.join(sourceRoot, "shared/Icon.tsx");
  const consumerFiles = await walk(sourceRoot);
  const [iconModule, consumers] = await Promise.all([
    readFile(iconFilename, "utf8"),
    Promise.all(
      consumerFiles
        .filter((filename) => filename !== iconFilename)
        .map((filename) => readFile(filename, "utf8")),
    ).then((bodies) => bodies.join("\n")),
  ]);
  return findUnusedIconNames(iconModule, consumers).map(
    (iconName) => `Icon ${iconName} is defined but has no production consumer.`,
  );
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(filename)));
    else if (
      /\.(?:ts|tsx)$/u.test(filename) &&
      !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(filename)
    ) {
      files.push(filename);
    }
  }
  return files;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function main() {
  const violations = await verifyIconUsage();
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Shared icon catalog usage verified.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
