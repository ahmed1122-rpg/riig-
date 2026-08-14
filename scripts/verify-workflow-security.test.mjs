import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedGitHubActionPins,
  verifyWorkflowSecurity,
} from "./verify-workflow-security.mjs";

const ordinaryWorkflow = [
  "name: ci",
  "on: push",
  "jobs:",
  "  test:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  `      - uses: actions/checkout@${approvedGitHubActionPins["actions/checkout"]}`,
  `      - uses: actions/setup-node@${approvedGitHubActionPins["actions/setup-node"]}`,
  "        with:",
  "          node-version-file: .node-version",
].join("\n");
const auditWorkflow = [
  "name: dependency-audit",
  "on:",
  "  schedule:",
  '    - cron: "17 4 * * *"',
  "jobs:",
  "  audit:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  `      - uses: actions/checkout@${approvedGitHubActionPins["actions/checkout"]}`,
  `      - uses: actions/setup-node@${approvedGitHubActionPins["actions/setup-node"]}`,
  "        with:",
  "          node-version-file: .node-version",
  "      - run: npm audit --audit-level=high",
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
    [
      "name: unsafe",
      "on: push",
      "jobs:",
      "  test:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/setup-node@v6",
      "        with:",
      "          node-version: 24",
    ].join("\n"),
  ]);

  assert.match(violations.join("\n"), /not pinned by commit SHA/u);
  assert.match(violations.join("\n"), /must read Node\.js/u);
  assert.match(violations.join("\n"), /must not hard-code/u);
  assert.match(violations.join("\n"), /Scheduled dependency audit/u);
});

test("rejects stale checkout and setup-node action runtimes", () => {
  const stalePin = "1".repeat(40);
  const staleWorkflow = ordinaryWorkflow
    .replace(approvedGitHubActionPins["actions/checkout"], stalePin)
    .replace(approvedGitHubActionPins["actions/setup-node"], stalePin);
  const violations = verifyWorkflowSecurity([staleWorkflow]);

  assert.match(violations.join("\n"), /actions\/checkout must use/u);
  assert.match(violations.join("\n"), /actions\/setup-node must use/u);
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

test("detects chained and prefixed Node package-manager commands", () => {
  for (const command of [
    "echo ready && npm run verify:alerts",
    "NODE_ENV=test node scripts/check.mjs",
    "if npx eslint .; then echo ok; fi",
    "corepack npm --version",
  ]) {
    const workflow = [
      ordinaryWorkflow,
      "  composite-command:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      `      - run: ${command}`,
    ].join("\n");

    assert.match(
      verifyWorkflowSecurity([workflow]).join("\n"),
      /job composite-command runs Node\/npm without setup-node/u,
      command,
    );
  }
});

test("does not treat quoted npm help text as a CLI invocation", () => {
  const workflow = [
    ordinaryWorkflow,
    "  documentation:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    `      - run: echo 'npm run quality'`,
  ].join("\n");

  assert.doesNotMatch(
    verifyWorkflowSecurity([workflow]).join("\n"),
    /job documentation runs Node\/npm without setup-node/u,
  );
});

test("reads action pins and scheduled audits from the YAML graph, not comments", () => {
  const commentOnly = [
    ordinaryWorkflow,
    "# uses: untrusted/action@" + "1".repeat(40),
    "# schedule:",
    '#   - cron: "17 4 * * *"',
    "# run: npm audit --audit-level=high",
  ].join("\n");

  const violations = verifyWorkflowSecurity([commentOnly]);
  assert.doesNotMatch(violations.join("\n"), /untrusted\/action/u);
  assert.match(violations.join("\n"), /Scheduled dependency audit/u);
});
