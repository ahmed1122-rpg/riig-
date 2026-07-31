import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoots = ["apps", "packages"];
const violations = [];

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

for (const rootName of sourceRoots) {
  const root = join(repositoryRoot, rootName);
  const files = await walk(root);
  for (const file of files) {
    const content = await readFile(file, "utf8");
    const normalized = relative(repositoryRoot, file)
      .split(sep)
      .join("/");
    const imports = [
      ...content.matchAll(
        /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]);

    for (const specifier of imports) {
      if (!specifier) continue;
      if (normalized.startsWith("packages/") && specifier.includes("apps/")) {
        violations.push(
          `${normalized}: shared packages must not import application code (${specifier})`,
        );
      }
      if (normalized.startsWith("apps/web/") && specifier.includes("apps/api")) {
        violations.push(
          `${normalized}: web must use contracts/API clients, not import API internals`,
        );
      }
      if (normalized.startsWith("apps/api/") && specifier.includes("apps/web")) {
        violations.push(
          `${normalized}: API must not import web application code`,
        );
      }
    }

    if (
      normalized.includes("/routes") &&
      /new\s+InMemory[A-Za-z]+Repository/.test(content)
    ) {
      violations.push(
        `${normalized}: route modules must receive repositories/services through composition`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Architecture boundary violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries verified.");
}

await import("./verify-documentation-contracts.mjs");
