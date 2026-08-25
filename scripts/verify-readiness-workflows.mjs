import { verifyPromotionWorkflowContract } from "./verify-promotion-workflow-contract.mjs";
import { requireWorkflowTokens } from "./workflow-token-contract.mjs";

export function verifyReadinessWorkflowContracts(workflowSources) {
  const violations = [];
  const releaseWorkflow = workflowSources[1];
  for (const token of [
    "verify-source:",
    "needs: verify-source",
    "environment: production-release",
    "npm run quality",
    "npm run verify:alerts",
    "npm run test:topology:full",
    "release-source-evidence-${{ inputs.candidate_sha }}",
    "release-source-evidence/fault-recovery-report.json",
    "release-source-evidence/topology-pdf-load-report.json",
    "cosign sign --yes",
    "Verify repository-bound signatures",
    "--certificate-identity \"${identity}\"",
    "RUNTIME_IMAGE_REF",
    "WEB_IMAGE_REF",
    "@${{ steps.runtime.outputs.digest }}",
    "sbom: true",
    "provenance: mode=max",
    "candidate_sha:",
    "test \"$GITHUB_REF\" = \"refs/heads/main\"",
    "RELEASE_SIGNATURE_WORKFLOW=release-images.yml",
    "RELEASE_SIGNATURE_IDENTITY_REF=${GITHUB_REF}",
    "No stable tag or GitHub Release was created.",
  ]) {
    if (!releaseWorkflow.includes(token)) {
      violations.push(
        `Release workflow is missing immutable supply-chain token: ${token}`,
      );
    }
  }
  if (releaseWorkflow.includes("gh release create")) {
    violations.push(
      "The candidate image workflow must not create a tag or stable GitHub Release.",
    );
  }
  if (
    releaseWorkflow.indexOf("publish:") <
    releaseWorkflow.indexOf("verify-source:")
  ) {
    violations.push(
      "Release image publishing must remain downstream of the source verification job.",
    );
  }
  if (
    releaseWorkflow.indexOf("Sign approved immutable image digests") <
    releaseWorkflow.indexOf("Scan published web digest")
  ) {
    violations.push(
      "Release image signing must occur only after both vulnerability scans pass.",
    );
  }

  requireWorkflowTokens(
    violations,
    workflowSources[3],
    "Provider-readiness identity",
    [
      "Reject ambiguous or missing provider credentials",
      "AWS_ROLE_ARN",
      "AWS_REGION",
      "Configure short-lived AWS credentials through GitHub OIDC",
      "aws-actions/configure-aws-credentials@",
      "role-to-assume: ${{ vars.AWS_ROLE_ARN }}",
      "Choose AWS OIDC or explicit S3 credentials, not both.",
      "RECOVERY_MANIFEST_JSON: ${{ secrets.RECOVERY_MANIFEST_JSON }}",
      "RECOVERY_SIGNING_PUBLIC_KEY_PEM",
      "CHARACTER_RIG_ENABLED: ${{ vars.CHARACTER_RIG_ENABLED }}",
      "CHARACTER_INFERENCE_API_KEY: ${{ secrets.CHARACTER_INFERENCE_API_KEY }}",
      "npm run verify:character-provider",
      ".tmp/character-provider-evidence.json",
      "RELEASE_SIGNATURE_WORKFLOW: ${{ vars.RELEASE_SIGNATURE_WORKFLOW }}",
      "--public-key recovery-public-key.pem",
      "--release-env provider-release.env",
      "Remove raw recovery material",
      "path: release-gate-evidence",
      "provider-readiness-evidence-${{ vars.RELEASE_GIT_SHA }}",
      ".tmp/provider-object-storage-evidence.json",
      "package-release-gate-evidence.mjs",
    ],
  );
  requireWorkflowTokens(violations, workflowSources[4], "Staging-readiness", [
    "environment: production-readiness",
    "DATABASE_URL: ${{ secrets.DATABASE_URL }}",
    "REDIS_URL: ${{ secrets.REDIS_URL }}",
    "SMTP_PASSWORD: ${{ secrets.SMTP_PASSWORD }}",
    "Configure short-lived AWS credentials through GitHub OIDC",
    "npm run verify:staging-dependencies --workspace @motionprep/api",
    "npm run verify:object-storage",
    "RELEASE_SIGNATURE_WORKFLOW: ${{ vars.RELEASE_SIGNATURE_WORKFLOW }}",
    "--candidate --verify-images",
    "Recovery evidence: intentionally remains in the production provider gate",
    "staging-dependency-evidence-${{ vars.RELEASE_GIT_SHA }}",
    ".tmp/staging-dependency-evidence.json",
    ".tmp/staging-object-storage-evidence.json",
    "package-release-gate-evidence.mjs",
  ]);
  requireWorkflowTokens(
    violations,
    workflowSources[5],
    "Performance-readiness",
    [
      'LOAD_MIN_CONCURRENCY: "4"',
      'LOAD_MIN_TOTAL_JOURNEYS: "12"',
      "LOAD_MAX_API_RSS_GROWTH_BYTES",
      "LOAD_MAX_WORKER_RSS_GROWTH_BYTES",
      "LOAD_MAX_QUEUE_AGE_SECONDS",
      'LOAD_MAX_FINAL_QUEUE_DEPTH: "0"',
      'LOAD_REQUIRE_METRICS: "true"',
      'LOAD_REQUIRE_RELEASE_IDENTITY: "true"',
      "LOAD_RELEASE_GIT_SHA: ${{ vars.RELEASE_GIT_SHA }}",
      "LOAD_EXPECTED_APPLICATION_VERSION: ${{ vars.EXPECTED_APPLICATION_VERSION }}",
      "Verify deployed release identity before the load run",
      "RELEASE_SIGNATURE_WORKFLOW: ${{ vars.RELEASE_SIGNATURE_WORKFLOW }}",
      "--candidate --verify-images",
      ".tmp/performance-release-evidence.json",
      "package-release-gate-evidence.mjs",
    ],
  );
  requireWorkflowTokens(
    violations,
    workflowSources[6],
    "Staging-application",
    [
      "npm run verify:staging-application",
      "RELEASE_SIGNATURE_WORKFLOW: ${{ vars.RELEASE_SIGNATURE_WORKFLOW }}",
      "--candidate --verify-images",
      'LOAD_REQUIRE_RELEASE_IDENTITY: "true"',
      "LOAD_RELEASE_GIT_SHA: ${{ vars.RELEASE_GIT_SHA }}",
      "LOAD_EXPECTED_APPLICATION_VERSION: ${{ vars.EXPECTED_APPLICATION_VERSION }}",
      "LOAD_RUNTIME_IMAGE_REF: ${{ vars.RUNTIME_IMAGE_REF }}",
      "LOAD_WEB_IMAGE_REF: ${{ vars.WEB_IMAGE_REF }}",
      "package-release-gate-evidence.mjs",
    ],
  );
  requireWorkflowTokens(violations, workflowSources[7], "Release rollback", [
    "environment: production-readiness",
    "ROLLBACK_RUNTIME_IMAGE_REF",
    "ROLLBACK_WEB_IMAGE_REF",
    "CANDIDATE_SIGNATURE_WORKFLOW",
    "CANDIDATE_SIGNATURE_IDENTITY_REF",
    "ROLLBACK_SIGNATURE_WORKFLOW",
    "ROLLBACK_SIGNATURE_IDENTITY_REF",
    "RELEASE_SIGNATURE_WORKFLOW=$ROLLBACK_SIGNATURE_WORKFLOW",
    "Install Cosign",
    "npm run test:release-rollback",
    "release-rollback-evidence-${{ vars.RELEASE_GIT_SHA }}",
    ".tmp/release-rollback-evidence.json",
    ".tmp/release-drill-rollback-pdf.json",
    "package-release-gate-evidence.mjs",
  ]);
  violations.push(
    ...verifyPromotionWorkflowContract({
      promotionWorkflow: workflowSources[9],
      dependencyWorkflow: workflowSources[8],
    }),
  );
  return violations;
}
