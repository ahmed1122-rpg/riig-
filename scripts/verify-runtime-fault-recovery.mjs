import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { prometheusMetricValues } from "./load-test-utils.mjs";

const apiOrigin = process.env.MOTIONPREP_API_ORIGIN ?? "http://127.0.0.1:54101";
const metricsToken =
  process.env.MOTIONPREP_METRICS_BEARER_TOKEN ??
  "metrics-integration-token-at-least-32-characters";
const reportPath = resolve(
  process.env.FAULT_REPORT_PATH ?? ".tmp/fault-recovery-report.json",
);
const compose = ["compose", "-f", "compose.integration.yaml"];
const scenarios = [
  { dependency: "redis", metric: "redis", label: "Redis" },
  { dependency: "minio", metric: "object_storage", label: "object storage" },
  { dependency: "mailpit", metric: "smtp", label: "SMTP" },
  { dependency: "postgres", metric: "database", label: "PostgreSQL" },
];
const evidence = [];
const workerServices = ["worker-media", "worker-document", "worker-export"];

await waitForReadiness(200, "initial dependency readiness", 60_000);

for (const scenario of scenarios) {
  const startedAt = Date.now();
  let stopped = false;
  try {
    dockerCompose("stop", scenario.dependency);
    stopped = true;
    await waitForReadiness(
      503,
      `${scenario.label} outage to fail readiness closed`,
      60_000,
    );
    await waitForDependencyMetric(
      scenario.metric,
      0,
      `${scenario.label} provider metric to fail closed`,
      60_000,
    );
  } finally {
    if (stopped) dockerCompose("start", scenario.dependency);
  }
  await waitForReadiness(
    200,
    `${scenario.label} recovery to restore readiness`,
    90_000,
  );
  await waitForDependencyMetric(
    scenario.metric,
    1,
    `${scenario.label} provider metric to recover`,
    90_000,
  );
  await waitForHealthyServices(
    workerServices,
    `${scenario.label} recovery to restore worker health`,
    60_000,
  );
  evidence.push({
    dependency: scenario.dependency,
    outageDetected: true,
    readinessRecovered: true,
    workersRecovered: true,
    providerMetricRecovered: true,
    elapsedMs: Date.now() - startedAt,
  });
}

async function waitForHealthyServices(services, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastState = "unknown";
  while (Date.now() < deadline) {
    const states = services.map((service) => serviceState(service));
    lastState = states.join(", ");
    if (states.every((state) => state === "running/healthy")) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${label}; last state ${lastState}.`);
}

function serviceState(service) {
  const id = dockerOutput("compose", ...compose.slice(1), "ps", "--quiet", service);
  if (!id) return `${service}=missing`;
  const state = dockerOutput(
    "inspect",
    "--format",
    "{{.State.Status}}/{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
    id,
  );
  return `${service}=${state}`.replace(`${service}=running/healthy`, "running/healthy");
}

const report = {
  schemaVersion: 1,
  status: "passed",
  completedAt: new Date().toISOString(),
  apiOrigin,
  release: process.env.RELEASE_VERSION ?? "integration",
  evidence,
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

async function waitForDependencyMetric(dependency, expected, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = "missing";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiOrigin}/internal/metrics`, {
        headers: { authorization: `Bearer ${metricsToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) {
        const values = prometheusMetricValues(
          await response.text(),
          "motionprep_dependency_ready",
          { dependency },
        );
        lastValue = values[0] ?? "missing";
        if (values[0] === expected) return;
      } else {
        lastValue = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastValue = error instanceof Error ? error.name : "unreachable";
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Timed out waiting for ${label}; last value ${lastValue}.`);
}

async function waitForReadiness(expectedStatus, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "unreachable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiOrigin}/v1/health/ready`, {
        signal: AbortSignal.timeout(15_000),
      });
      lastStatus = String(response.status);
      await response.body?.cancel();
      if (response.status === expectedStatus) return;
    } catch (error) {
      lastStatus = error instanceof Error ? error.name : "unreachable";
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Timed out waiting for ${label}; expected ${expectedStatus}, last result ${lastStatus}.`,
  );
}

function dockerCompose(...args) {
  const result = spawnSync("docker", [...compose, ...args], {
    shell: false,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `docker compose ${args.join(" ")} failed with status ${result.status ?? "unknown"}.`,
      result.error ? { cause: result.error } : undefined,
    );
  }
}

function dockerOutput(...args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error || result.status !== 0) return "";
  return result.stdout.trim();
}
