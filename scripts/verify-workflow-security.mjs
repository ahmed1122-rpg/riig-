import { parse } from "yaml";

export function verifyWorkflowSecurity(workflows) {
  const violations = [];
  for (const [index, workflow] of workflows.entries()) {
    let document;
    try {
      document = parse(workflow);
    } catch (error) {
      violations.push(
        `Workflow ${index + 1} is invalid YAML: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
    for (const match of workflow.matchAll(/uses:\s+([^@\s]+)@([^\s#]+)/gu)) {
      const [, action, reference] = match;
      if (!/^[a-f0-9]{40}$/u.test(reference ?? "")) {
        violations.push(
          `GitHub Action ${action ?? "unknown"} is not pinned by commit SHA: ${reference ?? "missing"}`,
        );
      }
    }
    if (workflow.includes("actions/setup-node@")) {
      if (!workflow.includes("node-version-file: .node-version")) {
        violations.push(`Workflow ${index + 1} must read Node.js from .node-version.`);
      }
      if (/^\s+node-version:/mu.test(workflow)) {
        violations.push(`Workflow ${index + 1} must not hard-code a Node.js version.`);
      }
    }
    for (const [jobName, job] of Object.entries(document?.jobs ?? {})) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      const runsNodeCli = steps.some(
        (step) =>
          typeof step?.run === "string" &&
          /^\s*(?:node|npm)(?:\s|$)/mu.test(step.run),
      );
      if (!runsNodeCli) continue;
      const setupNode = steps.find(
        (step) =>
          typeof step?.uses === "string" &&
          step.uses.startsWith("actions/setup-node@"),
      );
      if (setupNode?.with?.["node-version-file"] !== ".node-version") {
        violations.push(
          `Workflow ${index + 1} job ${jobName} runs Node/npm without setup-node reading .node-version.`,
        );
      }
    }
  }

  for (const token of [
    "schedule:",
    'cron: "17 4 * * *"',
    "node-version-file: .node-version",
    "npm audit --audit-level=high",
  ]) {
    if (!workflows[8]?.includes(token)) {
      violations.push(`Scheduled dependency audit workflow is missing token: ${token}`);
    }
  }
  return violations;
}
