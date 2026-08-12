import { lstat, readdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const removed = [];
const execFileAsync = promisify(execFile);

for (const workspaceRoot of ["apps", "packages"]) {
  const entries = await readdir(join(root, workspaceRoot), {
    withFileTypes: true,
  });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const workspace = join(root, workspaceRoot, entry.name);
    await removeGenerated(join(workspace, "dist"));
    await removeGenerated(join(workspace, "coverage"));
    for (const child of await readdir(workspace, { withFileTypes: true })) {
      if (child.isFile() && child.name.endsWith(".tsbuildinfo")) {
        await removeGenerated(join(workspace, child.name));
      }
    }
  }
}

for (const path of [
  "tmp",
  ".tmp",
  "artifacts/runtime-qa",
  "artifacts/playwright",
  "artifacts/playwright-report",
  "artifacts/test-results",
  "artifacts/screenshots",
  "artifacts/dogfood-alpha-segmentation/videos",
  "artifacts/dogfood-image-export/downloads",
  "artifacts/dogfood-image-export/videos",
  "artifacts/dogfood-pdf/videos",
  "artifacts/dogfood-runtime-stack/videos",
]) {
  await removeGenerated(join(root, path));
}

if (removed.length === 0) {
  process.stdout.write("No generated files or empty project directories found.\n");
} else {
  process.stdout.write(
    `Removed ${removed.length} generated paths:\n${removed
      .map((path) => `- ${path}`)
      .join("\n")}\n`,
  );
}

async function removeGenerated(path) {
  const absolute = resolve(path);
  const projectRelative = relative(root, absolute);
  if (
    projectRelative === "" ||
    projectRelative.startsWith("..") ||
    projectRelative.includes(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new Error(`Refusing to clean outside the workspace: ${absolute}`);
  }
  try {
    await lstat(absolute);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const tracked = await trackedFilesUnder(projectRelative);
  if (tracked.length > 0) {
    throw new Error(
      `Refusing to delete tracked files under ${projectRelative}: ${tracked.join(", ")}`,
    );
  }
  await rm(absolute, { recursive: true, force: true });
  removed.push(projectRelative.replaceAll("\\", "/"));
}

async function trackedFilesUnder(projectRelative) {
  const { stdout } = await execFileAsync(
    "git",
    ["ls-files", "--", projectRelative],
    { cwd: root, windowsHide: true },
  );
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}
