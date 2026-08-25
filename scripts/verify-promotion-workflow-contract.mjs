import { requireWorkflowTokens } from "./workflow-token-contract.mjs";

export function verifyPromotionWorkflowContract({
  promotionWorkflow,
  dependencyWorkflow,
}) {
  const violations = [];
  requireWorkflowTokens(
    violations,
    promotionWorkflow,
    "Stable release promotion",
    [
      "environment: production-release",
      "refs/heads/main",
      "npm run verify:release-legal",
      "npm run verify:release-promotion",
      "release-evidence.sigstore.json",
      "promotion-evidence.sigstore.json",
      "zero risk acceptances",
      "gh release create",
      "--draft",
      "--draft=false",
      "promoted by digest without rebuild",
      "actions: read",
      "stable-release/release.env",
      "RELEASE_SIGNATURE_WORKFLOW=promote-release.yml",
      "release.env.sigstore.json",
      "head_branch",
      "head_repository.full_name",
      "actions/workflows/$workflow_id",
      ".github/workflows/release-images.yml",
      ".github/workflows/release-rollback-drill.yml",
    ],
  );
  if (
    promotionWorkflow.includes("promotion.env") ||
    promotionWorkflow.includes("promotion-inputs/candidate/release.env\n")
  ) {
    violations.push(
      "Stable promotion must consume and attach the promotion-signed stable release.env, not the candidate descriptor.",
    );
  }
  if (
    dependencyWorkflow.includes("gh issue create") ||
    dependencyWorkflow.includes("issues: write")
  ) {
    violations.push(
      "Dependency security failures must not be escalated through public issues.",
    );
  }
  return violations;
}
