export function validateCharacterProviderEvidence(
  evidence,
  expectedGitSha,
  characterRigEnabled,
) {
  if (evidence?.releaseGitSha !== expectedGitSha) {
    return ["Character provider evidence belongs to another SHA."];
  }
  if (characterRigEnabled === "false") {
    if (
      evidence?.schemaVersion !== 1 ||
      evidence?.enabled !== false ||
      evidence?.verified !== false ||
      evidence?.status !== "disabled" ||
      !evidence?.checks?.includes("feature-disabled")
    ) {
      return ["Disabled Character provider gate evidence is invalid."];
    }
    return [];
  }
  const checks = new Set(evidence?.checks ?? []);
  if (
    characterRigEnabled !== "true" ||
    evidence?.schemaVersion !== 1 ||
    evidence?.enabled !== true ||
    evidence?.verified !== true ||
    evidence?.status !== "verified" ||
    evidence?.protocol !== "async-v1" ||
    [
      "https",
      "capabilities",
      "scale-to-zero-policy",
      "async-submission",
      "same-origin-status-polling",
      "terminal-success",
    ].some((check) => !checks.has(check))
  ) {
    return ["Enabled Character provider gate evidence is incomplete."];
  }
  return [];
}
