import { execFile } from "node:child_process";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const defaultRoot = fileURLToPath(new URL("../", import.meta.url));
const markdownLinkPattern = /!?\[[^\]]*\]\((?<target><[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\)/gu;
const windowsAbsolutePathPattern = /\b[A-Za-z]:\\[^\r\n"|]+/gu;

export async function verifyRepositoryPaths(repositoryRoot = defaultRoot) {
  const violations = [];
  const { files: trackedFiles, sourceImageFallback } =
    await listTrackedTextFiles(repositoryRoot);

  for (const relativePath of trackedFiles) {
    const absolutePath = path.join(repositoryRoot, relativePath);
    let body;
    try {
      body = await readFile(absolutePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (relativePath.endsWith(".md")) {
      violations.push(...(await findBrokenMarkdownLinks({
        repositoryRoot,
        relativePath,
        body,
        sourceImageFallback,
      })));
    }
    if (isPortableEvidenceFile(relativePath)) {
      for (const match of body.matchAll(windowsAbsolutePathPattern)) {
        violations.push(
          `${relativePath}:${lineNumberAt(body, match.index ?? 0)} contains a machine-specific absolute path: ${match[0]}`,
        );
      }
    }
  }

  return violations;
}

async function findBrokenMarkdownLinks({
  repositoryRoot,
  relativePath,
  body,
  sourceImageFallback,
}) {
  const violations = [];
  for (const match of body.matchAll(markdownLinkPattern)) {
    const rawTarget = match.groups?.target ?? "";
    const target = rawTarget.startsWith("<") && rawTarget.endsWith(">")
      ? rawTarget.slice(1, -1)
      : rawTarget;
    if (
      target === "" ||
      target.startsWith("#") ||
      /^(?:https?:|mailto:|data:)/iu.test(target)
    ) {
      continue;
    }
    const withoutFragment = target.split("#", 1)[0].split("?", 1)[0];
    if (!withoutFragment) continue;
    let decodedTarget;
    try {
      decodedTarget = decodeURIComponent(withoutFragment);
    } catch {
      violations.push(
        `${relativePath}:${lineNumberAt(body, match.index ?? 0)} contains an invalid encoded link: ${target}`,
      );
      continue;
    }
    const resolved = path.resolve(
      repositoryRoot,
      path.dirname(relativePath),
      decodedTarget,
    );
    if (!isInsideRepository(repositoryRoot, resolved)) {
      violations.push(
        `${relativePath}:${lineNumberAt(body, match.index ?? 0)} links outside the repository: ${target}`,
      );
      continue;
    }
    try {
      await access(resolved);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const repositoryRelativeTarget = path
        .relative(repositoryRoot, resolved)
        .replaceAll("\\", "/");
      if (
        sourceImageFallback &&
        repositoryRelativeTarget.startsWith("artifacts/")
      ) {
        continue;
      }
      violations.push(
        `${relativePath}:${lineNumberAt(body, match.index ?? 0)} links to a missing path: ${target}`,
      );
    }
  }
  return violations;
}

async function listTrackedTextFiles(repositoryRoot) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "*.md",
        "*.json",
        "*.txt",
      ],
      { cwd: repositoryRoot, encoding: "buffer", windowsHide: true },
    );
    return {
      files: uniquePortablePaths(stdout.toString("utf8").split("\0")),
      sourceImageFallback: false,
    };
  } catch (error) {
    const stderr = error?.stderr?.toString?.("utf8") ?? "";
    if (!stderr.includes("not a git repository")) throw error;
    return {
      files: await listSourceImageTextFiles(repositoryRoot),
      sourceImageFallback: true,
    };
  }
}

const sourceImageExcludedDirectories = new Set([
  ".git",
  ".tmp",
  "coverage",
  "dist",
  "node_modules",
  "playwright-report",
  "test-results",
]);

async function listSourceImageTextFiles(repositoryRoot) {
  const files = [];
  async function visit(directory, relativeDirectory = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const relativePath = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!sourceImageExcludedDirectories.has(entry.name)) {
          await visit(path.join(directory, entry.name), relativePath);
        }
        continue;
      }
      if (/\.(?:md|json|txt)$/iu.test(entry.name)) files.push(relativePath);
    }
  }
  await visit(repositoryRoot);
  return uniquePortablePaths(files);
}

function uniquePortablePaths(paths) {
  return [...new Set(paths.filter(Boolean).map((value) => value.replaceAll("\\", "/")))];
}

function isPortableEvidenceFile(relativePath) {
  return (
    /^(?:artifacts\/.*\.(?:json|txt)|assets\/visual-sources\/manifest\.json)$/u.test(
      relativePath,
    )
  );
}

function isInsideRepository(repositoryRoot, candidate) {
  const relative = path.relative(path.resolve(repositoryRoot), candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function lineNumberAt(body, index) {
  return body.slice(0, index).split("\n").length;
}

async function main() {
  const violations = await verifyRepositoryPaths();
  if (violations.length > 0) {
    for (const violation of violations) process.stderr.write(`- ${violation}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Tracked repository links and evidence paths verified.\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
