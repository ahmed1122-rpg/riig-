import assert from "node:assert/strict";
import test from "node:test";
import { verifyWorkflowSecurity } from "./verify-workflow-security.mjs";

const pinnedSha = "1".repeat(40);
const ordinaryWorkflow = [
  "name: ci",
  "on: push",
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  `      - uses: actions/setup-node@${pinnedSha}`,
  "        with:",
  "          node-version-file: .node-version",
].join("\n");
const auditWorkflow = [
  ordinaryWorkflow,
  "schedule:",
  '  - cron: "17 4 * * *"',
  "run: npm audit --audit-level=high",
].join("\n");

test("accepts pinned workflows using the shared Node version and scheduled audit", () => {
  assert.deepEqual(
    verifyWorkflowSecurity([
      ...Array.from({ length: 8 }, () => ordinaryWorkflow),
      auditWorkflow,
    ]),
    [],
  );
});

test("reports mutable actions, Node drift, and missing scheduled audit", () => {
  const violations = verifyWorkflowSecurity([
    "uses: actions/setup-node@v6\nwith:\n  node-version: 24\n",
  ]);

  assert.match(violations.join("\n"), /not pinned by commit SHA/u);
  assert.match(violations.join("\n"), /must read Node\.js/u);
  assert.match(violations.join("\n"), /must not hard-code/u);
  assert.match(violations.join("\n"), /Scheduled dependency audit/u);
});

test("requires setup-node in every job that invokes the Node or npm CLI", () => {
  const workflow = [
    ordinaryWorkflow,
    "  container:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - run: npm run verify:alerts",
  ].join("\n");
  const violations = verifyWorkflowSecurity([workflow]);

  assert.match(
    violations.join("\n"),
    /job container runs Node\/npm without setup-node/u,
  );
});
