import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const dynamicClasses = new Set([
  "app-shell--admin",
  "app-shell--dashboard",
  "app-shell--workspace",
  "density-comfortable",
  "guidance-stroke--separate",
  "is-blocked",
  "is-conflict",
  "is-dirty",
  "is-drag-over-after",
  "is-drag-over-before",
  "is-pending",
  "is-running",
  "is-saved",
  "is-saving",
  "is-succeeded",
  "is-unavailable",
  "preview-bg--checker",
  "preview-bg--transparent",
  "preview-bg--white",
  "preview-swatch--checker",
  "preview-swatch--dark",
  "preview-swatch--white",
  "project-preview--book",
  "recent-thumb--book",
  "status--danger",
  "status--processing",
]);

export function findUnusedCssClasses({ styles, sources, allowedDynamicClasses = dynamicClasses }) {
  const definedClasses = new Set(
    [...styles.matchAll(/\.([_a-zA-Z][\w-]*)/gu)].map((match) => match[1]),
  );
  return [...definedClasses]
    .filter(
      (className) =>
        !sources.includes(className) && !allowedDynamicClasses.has(className),
    )
    .sort();
}

export async function verifyCssUsage(repositoryRoot = defaultRoot) {
  const stylesDirectory = path.join(repositoryRoot, "apps/web/src/styles");
  const sourceDirectory = path.join(repositoryRoot, "apps/web/src");
  const [styleFiles, sourceFiles] = await Promise.all([
    walk(stylesDirectory, (filename) => filename.endsWith(".css")),
    walk(
      sourceDirectory,
      (filename) =>
        /\.(?:ts|tsx)$/u.test(filename) &&
        !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(filename),
    ),
  ]);
  const [styles, sources] = await Promise.all([
    readAll(styleFiles),
    readAll(sourceFiles),
  ]);
  return findUnusedCssClasses({ styles, sources }).map(
    (className) => `CSS class .${className} has no production source reference.`,
  );
}

async function walk(directory, include) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(filename, include)));
    else if (include(filename)) files.push(filename);
  }
  return files;
}

async function readAll(files) {
  return (await Promise.all(files.map((filename) => readFile(filename, "utf8")))).join(
    "\n",
  );
}

async function main() {
  const violations = await verifyCssUsage();
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `CSS usage verified (${dynamicClasses.size} reviewed dynamic class names).\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
