export async function inspectTargetRelease(
  { targetOrigin, requestTimeoutMs, releaseIdentity },
  fetchImplementation = globalThis.fetch,
) {
  if (!releaseIdentity) return null;
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetchImplementation(
      `${targetOrigin}/v1/health/ready`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(requestTimeoutMs),
      },
    );
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      return failedObservation(checkedAt, response.status, "Readiness was not JSON.");
    }
    const observedReleaseGitSha = body?.data?.release ?? null;
    const observedApplicationVersion = body?.data?.version ?? null;
    const passed =
      response.status === 200 &&
      observedReleaseGitSha === releaseIdentity.releaseGitSha &&
      observedApplicationVersion === releaseIdentity.applicationVersion;
    return {
      checkedAt,
      statusCode: response.status,
      passed,
      observedReleaseGitSha,
      observedApplicationVersion,
      error: passed
        ? null
        : "The deployed release identity differs from the protected load policy.",
    };
  } catch (error) {
    return failedObservation(
      checkedAt,
      null,
      error instanceof Error ? error.message : "Release identity probe failed.",
    );
  }
}

export function assertTargetRelease(observation) {
  if (observation === null || observation.passed) return;
  throw new Error(observation.error ?? "Target release identity verification failed.");
}

function failedObservation(checkedAt, statusCode, error) {
  return {
    checkedAt,
    statusCode,
    passed: false,
    observedReleaseGitSha: null,
    observedApplicationVersion: null,
    error,
  };
}
