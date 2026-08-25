import assert from "node:assert/strict";
import test from "node:test";
import { verifyPromotionWorkflowContract } from "./verify-promotion-workflow-contract.mjs";

const validPromotionWorkflow = [
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
].join("\n");

test("accepts immutable promotion and private dependency audit workflows", () => {
  assert.deepEqual(
    verifyPromotionWorkflowContract({
      promotionWorkflow: validPromotionWorkflow,
      dependencyWorkflow: "permissions:\n  contents: read",
    }),
    [],
  );
});

test("rejects candidate descriptors and public dependency issue escalation", () => {
  const violations = verifyPromotionWorkflowContract({
    promotionWorkflow: `${validPromotionWorkflow}\npromotion.env`,
    dependencyWorkflow: "permissions:\n  issues: write\nrun: gh issue create",
  });

  assert.match(violations.join("\n"), /promotion-signed stable release\.env/u);
  assert.match(violations.join("\n"), /public issues/u);
});

test("reports a missing stable promotion control", () => {
  const violations = verifyPromotionWorkflowContract({
    promotionWorkflow: validPromotionWorkflow.replace(
      "npm run verify:release-legal",
      "",
    ),
    dependencyWorkflow: "",
  });

  assert.match(violations.join("\n"), /verify:release-legal/u);
});
