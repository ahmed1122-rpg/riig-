import { readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { findDirectedCycles } from "./import-cycle-detector.mjs";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceRoots = ["apps", "packages"];
const violations = [];
const sourceFiles = [];

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
  sourceFiles.push(...files);
}

const sourceByAbsolutePath = new Map(
  sourceFiles.map((file) => [resolve(file), normalizeSourcePath(file)]),
);
const importGraph = new Map();

for (const file of sourceFiles) {
    const content = await readFile(file, "utf8");
    const normalized = normalizeSourcePath(file);
    const imports = [
      ...content.matchAll(
        /(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g,
      ),
    ].map((match) => match[1]);
    const dependencies = new Set();
    importGraph.set(normalized, dependencies);

    for (const specifier of imports) {
      if (!specifier) continue;
      if (specifier.startsWith(".")) {
        const dependency = resolveRelativeSource(file, specifier);
        if (dependency) dependencies.add(dependency);
      }
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

    for (const dependency of dependencies) {
      const webFeature = /^apps\/web\/src\/features\/([^/]+)\//u.exec(normalized)?.[1];
      const dependencyFeature = /^apps\/web\/src\/features\/([^/]+)\//u.exec(
        dependency,
      )?.[1];
      if (
        webFeature &&
        dependencyFeature &&
        webFeature !== dependencyFeature &&
        !/\.(?:test|spec)\.(?:ts|tsx)$/u.test(normalized)
      ) {
        violations.push(
          `${normalized}: feature ${webFeature} must use shared/domain modules instead of importing feature ${dependencyFeature}`,
        );
      }
      if (
        normalized.startsWith("apps/api/src/processing/") &&
        dependency.startsWith("apps/api/src/infrastructure/") &&
        !normalized.endsWith("processing-worker-runtime.ts")
      ) {
        violations.push(
          `${normalized}: processing application code must depend on ports, not infrastructure adapters`,
        );
      }
    }

    if (
      normalized === "apps/api/src/exports/export-service.ts" &&
      imports.includes("sharp")
    ) {
      violations.push(
        `${normalized}: API export orchestration must not eagerly load sharp`,
      );
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

for (const cycle of findDirectedCycles(importGraph)) {
  violations.push(`relative import cycle: ${cycle.join(" -> ")}`);
}

if (violations.length > 0) {
  console.error("Architecture boundary violations:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries verified.");
}

await import("./verify-documentation-contracts.mjs");

function normalizeSourcePath(file) {
  return relative(repositoryRoot, file).split(sep).join("/");
}

function resolveRelativeSource(importer, specifier) {
  const unresolved = resolve(dirname(importer), specifier);
  const withoutRuntimeExtension = unresolved.replace(/\.js$/u, "");
  const candidates = [
    unresolved,
    `${withoutRuntimeExtension}.ts`,
    `${withoutRuntimeExtension}.tsx`,
    join(withoutRuntimeExtension, "index.ts"),
    join(withoutRuntimeExtension, "index.tsx"),
  ];
  for (const candidate of candidates) {
    const dependency = sourceByAbsolutePath.get(resolve(candidate));
    if (dependency) return dependency;
  }
  return null;
}
