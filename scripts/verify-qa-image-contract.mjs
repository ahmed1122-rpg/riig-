export function verifyQaImageContract({ dockerfile, ciWorkflow, dockerignore }) {
  const violations = [];
  for (const token of [
    "AS qa",
    "git --version && fc-list --version",
    "npm ci",
    "COPY --from=qa-dependencies /workspace/apps ./apps",
    "COPY --from=qa-dependencies /workspace/packages ./packages",
    'CMD ["node", "scripts/run-quality-qa.mjs"]',
  ]) {
    if (!dockerfile.includes(token)) {
      violations.push(`QA image is missing required token: ${token}`);
    }
  }
  for (const token of [
    "file: Dockerfile.qa",
    "tags: motionprep-qa:ci",
    "Run the complete source quality gate in the QA image",
    "artifacts/qa/quality-summary.json",
  ]) {
    if (!ciWorkflow.includes(token)) {
      violations.push(`CI is missing QA image contract token: ${token}`);
    }
  }
  for (const evidencePath of [
    "!artifacts/adobe-golden/photoshop-result.txt",
    "!artifacts/adobe-golden/after-effects-result.txt",
  ]) {
    if (!dockerignore.includes(evidencePath)) {
      violations.push(
        `QA build context is missing licensed-app evidence: ${evidencePath}`,
      );
    }
  }
  return violations;
}
