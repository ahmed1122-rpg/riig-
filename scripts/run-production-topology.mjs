import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

const compose = ["compose", "-f", "compose.integration.yaml"];
const sourceWorkingDirectory = process.cwd();
const unicodeWindowsPath =
  process.platform === "win32" &&
  /[^\u0020-\u007e]/u.test(sourceWorkingDirectory);
const dockerWorkspace = createDockerWorkspace(sourceWorkingDirectory);
const buildEnvironment = {
  ...process.env,
  // Compose Bake cannot encode a non-ASCII Windows context in its gRPC header.
  // The temporary junction supplies an ASCII context; disabling Bake also
  // keeps the local path compatible across current Docker Desktop releases.
  ...(unicodeWindowsPath
    ? { DOCKER_BUILDKIT: "1", COMPOSE_BAKE: "false" }
    : {}),
};
let outcome = "failed";

try {
  runDocker([...compose, "build", "api-a"], {
    env: buildEnvironment,
    label: "integration runtime image build",
  });
  runDocker([...compose, "up", "--detach", "--no-build", "--wait"], {
    label: "production-shaped topology startup",
  });
  run(process.execPath, ["scripts/verify-production-topology.mjs"], {
    label: "production topology verification",
  });
  outcome = "passed";
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Topology verification failed."}\n`,
  );
  runDocker([...compose, "ps", "--all"], {
    allowFailure: true,
    label: "topology status diagnostics",
  });
  runDocker([...compose, "logs", "--no-color"], {
    allowFailure: true,
    label: "topology log diagnostics",
  });
} finally {
  try {
    runDocker([...compose, "down", "--volumes"], {
      allowFailure: true,
      label: "topology cleanup",
    });
  } finally {
    dockerWorkspace.cleanup();
  }
}

if (outcome !== "passed") process.exitCode = 1;

function runDocker(args, options = {}) {
  return run("docker", args, { ...options, cwd: dockerWorkspace.cwd });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? sourceWorkingDirectory,
    env: options.env ?? process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`${options.label ?? command} could not start.`, {
      cause: result.error,
    });
  }
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(
      `${options.label ?? command} exited with status ${result.status ?? "unknown"}.`,
    );
  }
  return result.status ?? 1;
}

function createDockerWorkspace(sourceDirectory) {
  if (!unicodeWindowsPath) {
    return { cwd: sourceDirectory, cleanup() {} };
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
    cleanup() {
      const allowedPrefix = `${temporaryDirectory}${sep}`;
      if (!resolve(root).startsWith(allowedPrefix)) {
        throw new Error(`Refusing to clean an unexpected path: ${root}.`);
      }
      rmSync(root, { force: true, recursive: true });
    },
  };
}
