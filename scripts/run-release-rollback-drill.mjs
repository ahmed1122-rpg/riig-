import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createDockerWorkspace } from "./docker-workspace.mjs";
import {
  createRollbackEvidence,
  loadReleaseDescriptor,
  signatureIdentity,
  validateDrillInputs,
  validateSignatureEvidenceUri,
} from "./release-drill-config.mjs";

const options = parseArguments(process.argv.slice(2));
const sourceWorkingDirectory = process.cwd();
const dockerWorkspace = createDockerWorkspace(sourceWorkingDirectory);
const compose = ["compose", "--profile", "release-drill", "-f", "compose.integration.yaml"];
const reportPath = resolve(
  process.env.ROLLBACK_EVIDENCE_PATH ?? ".tmp/release-rollback-evidence.json",
);
const startedAt = new Date();
const checks = {
  candidateSignatures: "pending",
  rollbackSignatures: "pending",
  candidateImages: "pending",
  rollbackImages: "pending",
  candidateReadiness: "pending",
  candidateWebHealth: "pending",
  candidatePdfJourney: "pending",
  applicationOnlyRollback: "pending",
  rollbackReadiness: "pending",
  rollbackWebHealth: "pending",
  rollbackPdfJourney: "pending",
};
let candidate;
let rollback;
let failure = null;
const signatureEvidence = {
  candidate: validateSignatureEvidenceUri(
    process.env.CANDIDATE_SIGNATURE_EVIDENCE_URI,
  ),
  rollback: validateSignatureEvidenceUri(
    process.env.ROLLBACK_SIGNATURE_EVIDENCE_URI,
  ),
};

try {
  candidate = await loadReleaseDescriptor(options.candidateEnv, options.candidateTag);
  rollback = await loadReleaseDescriptor(options.rollbackEnv, options.rollbackTag);
  validateDrillInputs(candidate, rollback, options.repository);

  checks.candidateSignatures = verifySignatures(
    candidate,
    signatureEvidence.candidate,
  );
  checks.rollbackSignatures = verifySignatures(
    rollback,
    signatureEvidence.rollback,
  );
  checks.candidateImages = pullRelease(candidate);
  checks.rollbackImages = pullRelease(rollback);

  runDocker([...compose, "down", "--volumes", "--remove-orphans"], {
    allowFailure: true,
    env: releaseEnvironment(candidate),
    label: "pre-drill cleanup",
  });
  runDocker([...compose, "up", "--detach", "--no-build", "--wait"], {
    env: releaseEnvironment(candidate),
    label: "candidate topology startup",
  });
  await verifyHealthIdentity(candidate);
  checks.candidateReadiness = "passed";
  checks.candidateWebHealth = "passed";
  runPdfJourney("candidate");
  checks.candidatePdfJourney = "passed";

  // Do not run the older migration image after a forward deployment. The
  // schema is additive, so rollback replaces application services only.
  runDocker(
    [
      ...compose,
      "up",
      "--detach",
      "--no-build",
      "--no-deps",
      "--force-recreate",
      "--wait",
      "api-a",
      "api-b",
      "worker-media",
      "worker-document",
      "worker-export",
      "release-web",
    ],
    {
      env: releaseEnvironment(rollback),
      label: "application-only rollback",
    },
  );
  checks.applicationOnlyRollback = "passed";
  await verifyHealthIdentity(rollback);
  checks.rollbackReadiness = "passed";
  checks.rollbackWebHealth = "passed";
  runPdfJourney("rollback");
  checks.rollbackPdfJourney = "passed";
} catch (error) {
  failure = error instanceof Error ? error.message : "Release rollback drill failed.";
  process.stderr.write(`${failure}\n`);
  runDocker([...compose, "ps", "--all"], {
    allowFailure: true,
    env: rollback ? releaseEnvironment(rollback) : process.env,
    label: "rollback drill status diagnostics",
  });
  runDocker([...compose, "logs", "--no-color", "--tail", "250"], {
    allowFailure: true,
    env: rollback ? releaseEnvironment(rollback) : process.env,
    label: "rollback drill log diagnostics",
  });
} finally {
  try {
    runDocker([...compose, "down", "--volumes", "--remove-orphans"], {
      allowFailure: true,
      env: rollback ? releaseEnvironment(rollback) : process.env,
      label: "rollback drill cleanup",
    });
  } finally {
    dockerWorkspace.cleanup();
  }
}

const evidence = createRollbackEvidence({
  repository: options.repository,
  candidate: candidate ?? { source: options.candidateEnv, releaseTag: options.candidateTag },
  rollback: rollback ?? { source: options.rollbackEnv, releaseTag: options.rollbackTag },
  startedAt,
  completedAt: new Date(),
  outcome: failure ? "failed" : "passed",
  checks,
  signatureEvidence,
  failure,
});
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
process.stdout.write(`Rollback evidence written to ${reportPath}.\n`);
if (failure) process.exitCode = 1;

function verifySignatures(release, externalEvidenceUri) {
  if (externalEvidenceUri) {
    process.stdout.write(
      `${release.releaseTag} signatures use retained workflow evidence: ${externalEvidenceUri}\n`,
    );
    return "passed-external-evidence";
  }
  const identity = signatureIdentity(options.repository, release.releaseTag);
  for (const image of [release.runtimeImage, release.webImage]) {
    run(
      process.env.COSIGN_BIN ?? "cosign",
      [
        "verify",
        "--certificate-identity",
        identity,
        "--certificate-oidc-issuer",
        "https://token.actions.githubusercontent.com",
        image,
      ],
      { label: `${release.releaseTag} signature verification` },
    );
  }
  return "passed";
}

function pullRelease(release) {
  let usedLocalCache = false;
  for (const image of [release.runtimeImage, release.webImage]) {
    let pulled = false;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const status = runDocker(["pull", image], {
        allowFailure: true,
        label: `${release.releaseTag} image pull attempt ${attempt}`,
      });
      if (status === 0) {
        pulled = true;
        break;
      }
    }
    if (pulled) continue;
    const cached =
      runDocker(["image", "inspect", "--format", "{{.Id}}", image], {
        allowFailure: true,
        label: `${release.releaseTag} local digest inspection`,
      }) === 0;
    if (!cached) {
      throw new Error(
        `${release.releaseTag} image could not be pulled or proven in the local digest cache.`,
      );
    }
    usedLocalCache = true;
    process.stdout.write(
      `${release.releaseTag} continues with the locally verified immutable digest after bounded registry failures.\n`,
    );
  }
  return usedLocalCache ? "passed-local-cache-after-pull-failure" : "passed";
}

async function verifyHealthIdentity(release) {
  await waitFor(async () => {
    const readiness = await fetch("http://127.0.0.1:54101/v1/health/ready", {
      signal: AbortSignal.timeout(5_000),
    });
    if (!readiness.ok) return false;
    const payload = await readiness.json();
    return payload?.data?.release === release.gitSha;
  }, `${release.releaseTag} readiness identity ${release.gitSha}`);
  await waitFor(async () => {
    const web = await fetch("http://127.0.0.1:58080/healthz", {
      signal: AbortSignal.timeout(5_000),
    });
    return web.ok && (await web.text()).trim() === "ok";
  }, `${release.releaseTag} web health`);
}

async function waitFor(check, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms.`, {
    cause: lastError,
  });
}

function runPdfJourney(stage) {
  run(process.execPath, ["scripts/load-pdf-workflow.mjs"], {
    env: {
      ...process.env,
      LOAD_TARGET_ORIGIN: "http://127.0.0.1:54101",
      LOAD_REQUEST_ORIGIN: "http://127.0.0.1:5173",
      LOAD_CONCURRENCY: "1",
      LOAD_ITERATIONS: "1",
      LOAD_METRICS_URL: "http://127.0.0.1:54101/internal/metrics",
      LOAD_METRICS_BEARER_TOKEN:
        "metrics-integration-token-at-least-32-characters",
      LOAD_MAX_FINAL_QUEUE_DEPTH: "0",
      LOAD_REPORT_PATH: `.tmp/release-drill-${stage}-pdf.json`,
    },
    label: `${stage} PDF journey`,
  });
}

function releaseEnvironment(release) {
  return {
    ...process.env,
    INTEGRATION_RUNTIME_IMAGE_REF: release.runtimeImage,
    INTEGRATION_WEB_IMAGE_REF: release.webImage,
    INTEGRATION_RELEASE_VERSION: release.gitSha,
  };
}

function runDocker(args, settings = {}) {
  return run("docker", args, { ...settings, cwd: dockerWorkspace.cwd });
}

function run(command, args, settings = {}) {
  const result = spawnSync(command, args, {
    cwd: settings.cwd ?? sourceWorkingDirectory,
    env: settings.env ?? process.env,
    shell: false,
    stdio: "inherit",
  });
  if (result.error) {
    throw new Error(`${settings.label ?? command} could not start.`, {
      cause: result.error,
    });
  }
  if (result.status !== 0 && !settings.allowFailure) {
    throw new Error(
      `${settings.label ?? command} exited with status ${result.status ?? "unknown"}.`,
    );
  }
  return result.status ?? 1;
}

function parseArguments(arguments_) {
  const values = { repository: "", candidateTag: "", rollbackTag: "" };
  const positional = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--repository") values.repository = arguments_[++index] ?? "";
    else if (argument === "--candidate-tag") values.candidateTag = arguments_[++index] ?? "";
    else if (argument === "--rollback-tag") values.rollbackTag = arguments_[++index] ?? "";
    else positional.push(argument);
  }
  if (positional.length !== 2 || !values.repository || !values.candidateTag || !values.rollbackTag) {
    throw new Error(
      "Usage: node scripts/run-release-rollback-drill.mjs <candidate.env> <rollback.env> --repository <owner/name> --candidate-tag <tag> --rollback-tag <tag>",
    );
  }
  return { ...values, candidateEnv: positional[0], rollbackEnv: positional[1] };
}
