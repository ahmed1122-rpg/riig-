import { parse } from "yaml";

export const approvedGitHubActionPins = Object.freeze({
  "actions/checkout": "9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0", // v7.0.0
  "actions/setup-node": "249970729cb0ef3589644e2896645e5dc5ba9c38", // v6.5.0
});

const nodeCliCommands = new Set([
  "corepack",
  "node",
  "node.exe",
  "npm",
  "npm.cmd",
  "npx",
  "npx.cmd",
]);
const commandPrefixes = new Set([
  "command",
  "do",
  "elif",
  "else",
  "env",
  "exec",
  "if",
  "sudo",
  "then",
  "time",
  "until",
  "while",
]);
const commandBoundaries = new Set([
  "\n",
  "$(",
  "(",
  "{",
  "!",
  ";",
  "&",
  "&&",
  "|",
  "||",
]);

function tokenizeShell(command) {
  const tokens = [];
  let word = "";
  let quote = null;

  function pushWord() {
    if (word) tokens.push(word);
    word = "";
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const next = command[index + 1];

    if (quote) {
      if (character === quote) {
        quote = null;
      } else if (quote === '"' && character === "\\" && next) {
        word += next;
        index += 1;
      } else {
        word += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "\\" && next) {
      word += next;
      index += 1;
    } else if (character === "#" && !word) {
      while (index + 1 < command.length && command[index + 1] !== "\n") index += 1;
    } else if (/\s/u.test(character)) {
      pushWord();
      if (character === "\n") tokens.push(character);
    } else if (character === "$" && next === "(") {
      pushWord();
      tokens.push("$(");
      index += 1;
    } else if (";&|(){}!".includes(character)) {
      pushWord();
      if ((character === "&" || character === "|") && next === character) {
        tokens.push(character + next);
        index += 1;
      } else {
        tokens.push(character);
      }
    } else {
      word += character;
    }
  }
  pushWord();
  return tokens;
}

function invokesNodeCli(command) {
  let commandPosition = true;
  for (const token of tokenizeShell(command)) {
    if (commandBoundaries.has(token)) {
      commandPosition = true;
    } else if (token === ")" || token === "}") {
      commandPosition = false;
    } else if (commandPosition) {
      const normalized = token.toLowerCase();
      if (nodeCliCommands.has(normalized)) return true;
      if (
        commandPrefixes.has(normalized) ||
        normalized.startsWith("-") ||
        /^[A-Za-z_][A-Za-z0-9_]*=/u.test(token)
      ) {
        continue;
      }
      commandPosition = false;
    }
  }
  return false;
}

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
      } else if (
        Object.hasOwn(approvedGitHubActionPins, action) &&
        approvedGitHubActionPins[action] !== reference
      ) {
        violations.push(
          `GitHub Action ${action} must use the repository-approved pin ${approvedGitHubActionPins[action]}.`,
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
          typeof step?.run === "string" && invokesNodeCli(step.run),
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
