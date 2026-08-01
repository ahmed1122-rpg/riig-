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
  run(process.execPath, ["scripts/verify-runtime-fault-recovery.mjs"], {
    label: "dependency fault and recovery verification",
  });
  run(process.execPath, ["scripts/load-pdf-workflow.mjs"], {
    env: {
      ...process.env,
      LOAD_CONCURRENCY: "2",
      LOAD_ITERATIONS: "1",
      LOAD_REQUEST_ORIGIN: "http://127.0.0.1:5173",
      LOAD_METRICS_URL: "http://127.0.0.1:54101/internal/metrics",
      LOAD_METRICS_BEARER_TOKEN:
        "metrics-integration-token-at-least-32-characters",
      LOAD_REPORT_PATH: ".tmp/topology-pdf-load-report.json",
    },
    label: "concurrent PDF workflow smoke load",
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
