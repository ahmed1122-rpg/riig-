export function verifyQaImageContract({ dockerfile, ciWorkflow, dockerignore }) {
  const violations = [];
  for (const token of [
    "AS qa",
    "git --version && fc-list --version",
    "npm ci",
    'CMD ["node", "scripts/run-quality-qa.mjs"]',
  ]) {
    if (!dockerfile.includes(token)) {
      violations.push(`QA image is missing required token: ${token}`);
    }
  }
  for (const workspace of ["apps", "packages"]) {
    const copyPattern = new RegExp(
      `^COPY\\s+(?:--[^\\s]+\\s+)*--from=qa-dependencies(?:\\s+--[^\\s]+)*\\s+/workspace/${workspace}\\s+\\./${workspace}\\s*$`,
      "mu",
    );
    if (!copyPattern.test(dockerfile)) {
      violations.push(
        `QA image must copy the ${workspace} workspace from qa-dependencies.`,
      );
    }
  }
  for (const token of [
    "file: Dockerfile.qa",
    "tags: motionprep-qa:ci",
    "Run the complete source quality gate in the QA image",
    "--user root",
    '--volume "${GITHUB_WORKSPACE}/artifacts/qa:/workspace/artifacts/qa"',
    "chown node:node /workspace/artifacts/qa",
    "artifacts/qa/quality-summary.json",
  ]) {
    if (!ciWorkflow.includes(token)) {
      violations.push(`CI is missing QA image contract token: ${token}`);
    }
  }
  for (const evidencePath of [
    "!.env.production.example",
    "!.env.production.api.example",
    "!.env.production.migrate.example",
    "!.env.production.maintenance.example",
    "!.env.production.worker.example",
    "!.env.production.worker-character.example",
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
