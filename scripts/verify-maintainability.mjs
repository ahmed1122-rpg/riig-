import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_ROOTS = ["apps", "packages", "scripts"];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".ts", ".tsx"]);
const EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".tmp",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);
const EXCLUDED_FILE_PATTERN = /(?:^|\.)((?:integration\.)?test|spec)\.[^.]+$/u;
const DEFAULT_BASELINE = "config/maintainability-baseline.json";

export async function collectProductionSources(workspace) {
  const files = [];
  for (const root of SOURCE_ROOTS) {
    await walk(path.join(workspace, root), files);
  }
  files.sort((left, right) => left.localeCompare(right));
  return Promise.all(
    files.map(async (absolutePath) => [
      relativePath(workspace, absolutePath),
      await readFile(absolutePath, "utf8"),
    ]),
  );
}

export function analyzeMaintainability(
  sources,
  { maxSourceLines = 500, minCloneLines = 16 } = {},
) {
  if (!Number.isInteger(maxSourceLines) || maxSourceLines < 1) {
    throw new Error("maxSourceLines must be a positive integer.");
  }
  if (!Number.isInteger(minCloneLines) || minCloneLines < 4) {
    throw new Error("minCloneLines must be an integer of at least 4.");
  }

  const sourceMetrics = sources.map(([file, source]) => {
    const lines = source.split(/\r?\n/u);
    return {
      file: file.replaceAll("\\", "/"),
      physicalLines: lines.length,
      sourceLines: lines.filter((line) => line.trim()).length,
      normalized: normalizeLines(lines),
    };
  });
  const oversizedFiles = Object.fromEntries(
    sourceMetrics
      .filter(({ sourceLines }) => sourceLines > maxSourceLines)
      .map(({ file, sourceLines }) => [file, sourceLines]),
  );
  const exactCloneBlocks = findExactCloneBlocks(sourceMetrics, minCloneLines);

  return {
    sourceFileCount: sourceMetrics.length,
    maxSourceLines,
    minCloneLines,
    oversizedFiles,
    exactCloneBlocks,
    exactCloneBlockCount: exactCloneBlocks.length,
    exactClonedLines: exactCloneBlocks.reduce(
      (total, clone) => total + clone.lines,
      0,
    ),
  };
}

export function verifyMaintainability(report, baseline) {
  const errors = [];
  if (report.maxSourceLines !== baseline.maxSourceLines) {
    errors.push("The configured maxSourceLines differs from the baseline.");
  }
  if (report.minCloneLines !== baseline.minCloneLines) {
    errors.push("The configured minCloneLines differs from the baseline.");
  }

  for (const [file, lines] of Object.entries(report.oversizedFiles)) {
    const allowed = baseline.oversizedFiles[file];
    if (allowed === undefined) {
      errors.push(`${file} is a new oversized production file (${lines} lines).`);
    } else if (lines > allowed) {
      errors.push(`${file} grew from its ${allowed}-line cap to ${lines} lines.`);
    }
  }
  if (report.exactCloneBlockCount > baseline.maxExactCloneBlocks) {
    errors.push(
      `Exact clone blocks increased from ${baseline.maxExactCloneBlocks} to ${report.exactCloneBlockCount}.`,
    );
  }
  if (report.exactClonedLines > baseline.maxExactClonedLines) {
    errors.push(
      `Exact cloned lines increased from ${baseline.maxExactClonedLines} to ${report.exactClonedLines}.`,
    );
  }
  return errors;
}

async function main() {
  const workspace = process.cwd();
  const baselinePath = path.resolve(
    workspace,
    process.env.MAINTAINABILITY_BASELINE ?? DEFAULT_BASELINE,
  );
  const measureOnly = process.argv.includes("--measure");
  const sources = await collectProductionSources(workspace);
  const baseline = measureOnly
    ? null
    : JSON.parse(await readFile(baselinePath, "utf8"));
  const report = analyzeMaintainability(sources, {
    maxSourceLines: baseline?.maxSourceLines ?? 500,
    minCloneLines: baseline?.minCloneLines ?? 16,
  });

  if (measureOnly) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const errors = verifyMaintainability(report, baseline);
  if (errors.length > 0) {
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `Maintainability ratchet passed (${report.sourceFileCount} files, ` +
      `${Object.keys(report.oversizedFiles).length} grandfathered oversized files, ` +
      `${report.exactCloneBlockCount} exact clone blocks).\n`,
  );
}

async function walk(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(absolutePath, files);
      continue;
    }
    if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
      !EXCLUDED_FILE_PATTERN.test(entry.name)
    ) {
      files.push(absolutePath);
    }
  }
}

function normalizeLines(lines) {
  const normalized = [];
  for (let index = 0; index < lines.length; index += 1) {
    const value = lines[index]
      .trim()
      .replace(/\s+/gu, " ");
    if (!value || value.startsWith("//")) continue;
    normalized.push({ value, line: index + 1 });
  }
  return normalized;
}

function findExactCloneBlocks(sourceMetrics, minimum) {
  const windows = new Map();
  for (const source of sourceMetrics) {
    for (let index = 0; index <= source.normalized.length - minimum; index += 1) {
      const signature = source.normalized
        .slice(index, index + minimum)
        .map(({ value }) => value)
        .join("\n");
      const occurrences = windows.get(signature) ?? [];
      occurrences.push({ file: source.file, index, normalized: source.normalized });
      windows.set(signature, occurrences);
    }
  }

  const diagonals = new Map();
  for (const occurrences of windows.values()) {
    if (occurrences.length < 2) continue;
    for (let left = 0; left < occurrences.length; left += 1) {
      for (let right = left + 1; right < occurrences.length; right += 1) {
        const first = occurrences[left];
        const second = occurrences[right];
        if (!first || !second) continue;
        if (first.file === second.file && second.index - first.index < minimum) {
          continue;
        }
        const key = `${first.file}\u0000${second.file}\u0000${second.index - first.index}`;
        const starts = diagonals.get(key) ?? {
          first,
          second,
          indices: new Set(),
        };
        starts.indices.add(first.index);
        diagonals.set(key, starts);
      }
    }
  }

  const clones = [];
  for (const { first, second, indices } of diagonals.values()) {
    const ordered = [...indices].sort((left, right) => left - right);
    let runStart = ordered[0];
    let previous = ordered[0];
    for (const current of [...ordered.slice(1), Number.NaN]) {
      if (current === previous + 1) {
        previous = current;
        continue;
      }
      if (runStart !== undefined && previous !== undefined) {
        const lines = minimum + previous - runStart;
        const secondStart = runStart + second.index - first.index;
        clones.push({
          first: {
            file: first.file,
            line: first.normalized[runStart]?.line ?? 1,
          },
          second: {
            file: second.file,
            line: second.normalized[secondStart]?.line ?? 1,
          },
          lines,
        });
      }
      runStart = current;
      previous = current;
    }
  }
  return clones.sort((left, right) =>
    `${left.first.file}:${left.first.line}:${left.second.file}:${left.second.line}`.localeCompare(
      `${right.first.file}:${right.first.line}:${right.second.file}:${right.second.line}`,
    ),
  );
}

function relativePath(workspace, absolutePath) {
  return path.relative(workspace, absolutePath).replaceAll("\\", "/");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
