import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

export function evaluateAuditReport(report, ledger, now = new Date()) {
  const violations = validateLedger(ledger, now);
  const exceptions = new Map(
    (ledger?.exceptions ?? []).map((entry) => [
      `${entry.package}:${String(entry.advisorySource)}`,
      entry,
    ]),
  );
  const vulnerabilities = report?.vulnerabilities ?? {};
  const covered = new Map();
  const used = new Set();

  const isCovered = (name, visiting = new Set()) => {
    if (covered.has(name)) return covered.get(name);
    if (visiting.has(name)) return false;
    const vulnerability = vulnerabilities[name];
    if (!vulnerability || !isBlockingSeverity(vulnerability.severity)) return true;
    const nextVisiting = new Set(visiting).add(name);
    const relevantVia = Array.isArray(vulnerability.via)
      ? vulnerability.via.filter((via) =>
          typeof via === "string" || isBlockingSeverity(via?.severity))
      : [];
    const result = relevantVia.length > 0 && relevantVia.every((via) => {
      if (typeof via === "string") return isCovered(via, nextVisiting);
      const key = `${name}:${String(via.source)}`;
      if (!exceptions.has(key)) return false;
      used.add(key);
      return true;
    });
    covered.set(name, result);
    return result;
  };

  for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
    if (isBlockingSeverity(vulnerability?.severity) && !isCovered(name)) {
      violations.push(
        `${name} has an unapproved ${vulnerability.severity} vulnerability.`,
      );
    }
  }
  for (const key of exceptions.keys()) {
    if (!used.has(key)) violations.push(`Audit exception ${key} is stale or unused.`);
  }
  return violations;
}

function validateLedger(ledger, now) {
  const violations = [];
  if (ledger?.schemaVersion !== 1 || !Array.isArray(ledger?.exceptions)) {
    return ["Dependency audit exception ledger must use schemaVersion 1."];
  }
  for (const [index, entry] of ledger.exceptions.entries()) {
    const label = `Dependency audit exception ${index + 1}`;
    if (!entry || typeof entry !== "object") {
      violations.push(`${label} must be an object.`);
      continue;
    }
    if (typeof entry.package !== "string" || !entry.package.trim()) {
      violations.push(`${label} requires package.`);
    }
    if (!["high", "critical"].includes(entry.severity)) {
      violations.push(`${label} severity must be high or critical.`);
    }
    if (typeof entry.justification !== "string" || entry.justification.length < 20) {
      violations.push(`${label} requires a concrete justification.`);
    }
    if (typeof entry.approvedBy !== "string" || !entry.approvedBy.trim()) {
      violations.push(`${label} requires approvedBy.`);
    }
    try {
      if (new URL(entry.trackingUrl).protocol !== "https:") throw new Error();
    } catch {
      violations.push(`${label} requires an HTTPS trackingUrl.`);
    }
    const expiry = new Date(entry.expiresAt);
    const maximum = now.getTime() + 30 * 24 * 60 * 60_000;
    if (!Number.isFinite(expiry.getTime()) || expiry <= now || expiry.getTime() > maximum) {
      violations.push(`${label} must expire within the next 30 days.`);
    }
  }
  return violations;
}

function isBlockingSeverity(value) {
  return value === "high" || value === "critical";
}

async function main() {
  const ledger = JSON.parse(await readFile(
    `${root}/security/dependency-audit-exceptions.json`,
    "utf8",
  ));
  const npmCli = process.env.npm_execpath;
  const audit = npmCli
    ? spawnSync(process.execPath, [npmCli, "audit", "--json", "--audit-level=high"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
      })
    : spawnSync("npm", ["audit", "--json", "--audit-level=high"], {
        cwd: root,
        encoding: "utf8",
        shell: process.platform === "win32",
        maxBuffer: 20 * 1024 * 1024,
      });
  if (audit.error) throw audit.error;
  let report;
  try {
    report = JSON.parse(audit.stdout);
  } catch {
    throw new Error(`npm audit did not return JSON: ${audit.stderr || "unknown error"}`);
  }
  const violations = evaluateAuditReport(report, ledger);
  if (violations.length > 0) {
    throw new Error(`Dependency audit failed:\n- ${violations.join("\n- ")}`);
  }
  process.stdout.write("Dependency audit passed with no unapproved high or critical findings.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
