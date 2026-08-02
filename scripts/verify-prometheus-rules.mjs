import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const image =
  "prom/prometheus:v3.7.3@sha256:49214755b6153f90a597adcbff0252cc61069f8ab69ce8411285cd4a560e8038";
const source = process.cwd();
const workspace = asciiWorkspace(source);
try {
  run("check", "rules", "/workspace/deploy/prometheus-alerts.yml");
  run("test", "rules", "/workspace/deploy/prometheus-alerts.test.yml");
} finally {
  workspace.cleanup();
}

function run(...args) {
  const result = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=64m",
      "--mount",
      `type=bind,source=${workspace.cwd},target=/workspace,readonly`,
      "--entrypoint",
      "/bin/promtool",
      image,
      ...args,
    ],
    { shell: false, stdio: "inherit" },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`promtool ${args.join(" ")} failed.`, {
      cause: result.error,
    });
  }
}

function asciiWorkspace(directory) {
  if (!/[^\u0020-\u007e]/u.test(directory)) {
    return { cwd: directory, cleanup() {} };
  }
  const temporaryDirectory = resolve(tmpdir());
  const root = mkdtempSync(join(temporaryDirectory, "motionprep-promtool-"));
  const linked = join(root, "workspace");
  symlinkSync(directory, linked, "junction");
  return {
    cwd: linked,
    cleanup() {
      if (!resolve(root).startsWith(`${temporaryDirectory}${sep}`)) {
        throw new Error(`Refusing to clean unexpected path ${root}.`);
      }
      rmSync(root, { force: true, recursive: true });
    },
  };
}
