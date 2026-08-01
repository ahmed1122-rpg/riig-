import { spawnSync } from "node:child_process";

const apiOrigin = process.env.MOTIONPREP_API_ORIGIN ?? "http://127.0.0.1:54101";
const compose = ["compose", "-f", "compose.integration.yaml"];
const scenarios = [
  { dependency: "redis", label: "Redis" },
  { dependency: "minio", label: "object storage" },
  { dependency: "mailpit", label: "SMTP" },
  { dependency: "postgres", label: "PostgreSQL" },
];
const evidence = [];

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
  } finally {
    if (stopped) dockerCompose("start", scenario.dependency);
  }
  await waitForReadiness(
    200,
    `${scenario.label} recovery to restore readiness`,
    90_000,
  );
  evidence.push({
    dependency: scenario.dependency,
    outageDetected: true,
    readinessRecovered: true,
    elapsedMs: Date.now() - startedAt,
  });
}

process.stdout.write(
  `${JSON.stringify({ status: "passed", apiOrigin, evidence }, null, 2)}\n`,
);

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
