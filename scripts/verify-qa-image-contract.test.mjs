import assert from "node:assert/strict";
import test from "node:test";
import { verifyQaImageContract } from "./verify-qa-image-contract.mjs";

const dockerfile = `FROM node@sha256:${"a".repeat(64)} AS qa
RUN git --version && fc-list --version
RUN npm ci
COPY --from=qa-dependencies /workspace/apps ./apps
COPY --from=qa-dependencies /workspace/packages ./packages
CMD ["node", "scripts/run-quality-qa.mjs"]
`;
const workflow = `file: Dockerfile.qa
tags: motionprep-qa:ci
name: Run the complete source quality gate in the QA image
path: artifacts/qa/quality-summary.json
`;
const dockerignore = `!artifacts/adobe-golden/photoshop-result.txt
!artifacts/adobe-golden/after-effects-result.txt
`;

test("accepts a reproducible QA image wired to CI evidence", () => {
  assert.deepEqual(
    verifyQaImageContract({ dockerfile, ciWorkflow: workflow, dockerignore }),
    [],
  );
});

test("rejects a QA image without Git and CI execution", () => {
  const violations = verifyQaImageContract({
    dockerfile: dockerfile.replace(
      "git --version && fc-list --version",
      "node --version",
    ),
    ciWorkflow: "",
    dockerignore: "",
  });
  assert.match(violations.join("\n"), /git --version/u);
  assert.match(violations.join("\n"), /Dockerfile\.qa/u);
  assert.match(violations.join("\n"), /photoshop-result\.txt/u);
});
