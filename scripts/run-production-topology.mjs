import { spawnSync } from "node:child_process";
import { createDockerWorkspace } from "./docker-workspace.mjs";
import {
  integrationEndpoints,
  withAvailableIntegrationPorts,
} from "./integration-endpoints.mjs";

const compose = ["compose", "-f", "compose.integration.yaml"];
const sourceWorkingDirectory = process.cwd();
const dockerWorkspace = createDockerWorkspace(sourceWorkingDirectory);
const releaseVersion =
  process.env.RELEASE_VERSION ??
  process.env.INTEGRATION_RELEASE_VERSION ??
  "0".repeat(40);
const integrationEnvironment = await withAvailableIntegrationPorts(process.env);
const endpoints = integrationEndpoints(integrationEnvironment);
const topologyEnvironment = {
  ...integrationEnvironment,
  RELEASE_VERSION: releaseVersion,
  INTEGRATION_RELEASE_VERSION: releaseVersion,
  MOTIONPREP_API_ORIGIN:
    process.env.MOTIONPREP_API_ORIGIN ?? endpoints.apiOrigins[0],
};
const buildEnvironment = {
  ...topologyEnvironment,
  // Compose Bake cannot encode a non-ASCII Windows context in its gRPC header.
  // The temporary junction supplies an ASCII context; disabling Bake also
  // keeps the local path compatible across current Docker Desktop releases.
  ...(dockerWorkspace.unicodeWindowsPath
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
    env: topologyEnvironment,
    label: "production-shaped topology startup",
  });
  run(process.execPath, ["scripts/verify-production-topology.mjs"], {
    env: topologyEnvironment,
    label: "production topology verification",
  });
  run(process.execPath, ["scripts/verify-runtime-fault-recovery.mjs"], {
    env: topologyEnvironment,
    label: "dependency fault and recovery verification",
  });
  run(process.execPath, ["scripts/load-pdf-workflow.mjs"], {
    env: {
      ...topologyEnvironment,
      LOAD_CONCURRENCY: process.env.LOAD_CONCURRENCY ?? "2",
      LOAD_ITERATIONS: process.env.LOAD_ITERATIONS ?? "1",
      LOAD_TARGET_ORIGIN:
        process.env.LOAD_TARGET_ORIGIN ?? endpoints.apiOrigins[0],
      LOAD_REQUEST_ORIGIN:
        process.env.LOAD_REQUEST_ORIGIN ?? "http://127.0.0.1:5173",
      LOAD_METRICS_URL:
        process.env.LOAD_METRICS_URL ??
        `${endpoints.apiOrigins[0]}/internal/metrics`,
      LOAD_METRICS_BEARER_TOKEN:
        "metrics-integration-token-at-least-32-characters",
      LOAD_METRICS_SAMPLE_INTERVAL_MS: "1000",
      LOAD_REPORT_PATH:
        process.env.LOAD_REPORT_PATH ?? ".tmp/topology-pdf-load-report.json",
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
    env: topologyEnvironment,
    label: "topology status diagnostics",
  });
  runDocker([...compose, "logs", "--no-color"], {
    allowFailure: true,
    env: topologyEnvironment,
    label: "topology log diagnostics",
  });
} finally {
  try {
    runDocker([...compose, "down", "--volumes"], {
      allowFailure: true,
      env: topologyEnvironment,
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
