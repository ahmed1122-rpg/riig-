import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

export function createDockerWorkspace(sourceDirectory = process.cwd()) {
  const unicodeWindowsPath =
    process.platform === "win32" &&
    /[^\u0020-\u007e]/u.test(sourceDirectory);
  if (!unicodeWindowsPath) {
    return { cwd: sourceDirectory, unicodeWindowsPath, cleanup() {} };
  }

  const temporaryDirectory = resolve(tmpdir());
  if (/[^\u0020-\u007e]/u.test(temporaryDirectory)) {
    throw new Error(
      `Docker requires an ASCII temporary path; received ${temporaryDirectory}.`,
    );
  }

  const root = mkdtempSync(join(temporaryDirectory, "motionprep-docker-"));
  const workspace = join(root, "workspace");
  symlinkSync(sourceDirectory, workspace, "junction");
  process.stdout.write(`Using temporary Docker workspace ${workspace}.\n`);

  return {
    cwd: workspace,
    unicodeWindowsPath,
    cleanup() {
      const allowedPrefix = `${temporaryDirectory}${sep}`;
      if (!resolve(root).startsWith(allowedPrefix)) {
        throw new Error(`Refusing to clean an unexpected path: ${root}.`);
      }
      rmSync(root, { force: true, recursive: true });
    },
  };
}
