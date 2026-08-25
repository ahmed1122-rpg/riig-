import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const blockingSeverities = new Set(["HIGH", "CRITICAL"]);

export function evaluateTrivyReports(reports, ledger, now = new Date()) {
  const violations = validateLedger(ledger, now);
  const exceptions = new Map();
  const used = new Set();

  for (const entry of ledger?.exceptions ?? []) {
    const key = `${entry.target}:${entry.vulnerabilityId}`;
    if (exceptions.has(key)) {
      violations.push(`Trivy exception ${key} is duplicated.`);
    } else {
      exceptions.set(key, entry);
    }
  }

  for (const [target, report] of Object.entries(reports ?? {})) {
    const findings = collectUnfixedFindings(report);
    for (const finding of findings) {
      const key = `${target}:${finding.vulnerabilityId}`;
      const exception = exceptions.get(key);
      if (!exception) {
        violations.push(
          `${key} has an unapproved ${finding.severity.toLowerCase()} finding in ${finding.package}.`,
        );
        continue;
      }
      if (exception.severity !== finding.severity.toLowerCase()) {
        violations.push(`${key} severity does not match the current Trivy finding.`);
        continue;
      }
      if (!exception.packages.includes(finding.package)) {
        violations.push(`${key} does not approve package ${finding.package}.`);
        continue;
      }
      used.add(key);
    }
  }

  for (const key of exceptions.keys()) {
    if (!used.has(key)) violations.push(`Trivy exception ${key} is stale or unused.`);
  }
  return violations;
}

function collectUnfixedFindings(report) {
  const findings = [];
  for (const result of report?.Results ?? []) {
    for (const vulnerability of result?.Vulnerabilities ?? []) {
      const severity = String(vulnerability?.Severity ?? "").toUpperCase();
      if (!blockingSeverities.has(severity)) continue;
      if (String(vulnerability?.FixedVersion ?? "").trim()) continue;
      findings.push({
        vulnerabilityId: String(vulnerability?.VulnerabilityID ?? ""),
        package: String(vulnerability?.PkgName ?? ""),
        severity,
      });
    }
  }
  return findings;
}

function validateLedger(ledger, now) {
  const violations = [];
  if (ledger?.schemaVersion !== 1 || !Array.isArray(ledger?.exceptions)) {
    return ["Trivy exception ledger must use schemaVersion 1."];
  }
  for (const [index, entry] of ledger.exceptions.entries()) {
    const label = `Trivy exception ${index + 1}`;
    if (!entry || typeof entry !== "object") {
      violations.push(`${label} must be an object.`);
      continue;
    }
    if (typeof entry.target !== "string" || !entry.target.trim()) {
      violations.push(`${label} requires target.`);
    }
    if (!/^CVE-\d{4}-\d+$/u.test(entry.vulnerabilityId ?? "")) {
      violations.push(`${label} requires a CVE vulnerabilityId.`);
    }
    if (!Array.isArray(entry.packages) || entry.packages.length === 0 ||
        entry.packages.some((name) => typeof name !== "string" || !name.trim())) {
      violations.push(`${label} requires one or more packages.`);
    }
    if (!["high", "critical"].includes(entry.severity)) {
      violations.push(`${label} severity must be high or critical.`);
    }
    if (typeof entry.justification !== "string" || entry.justification.length < 40) {
      violations.push(`${label} requires a concrete mitigation and justification.`);
    }
    if (typeof entry.approvedBy !== "string" || !entry.approvedBy.trim()) {
      violations.push(`${label} requires approvedBy.`);
    }
    if (!isHttpsUrl(entry.trackingUrl)) {
      violations.push(`${label} requires an HTTPS trackingUrl.`);
    }
    if (!expiresWithinThirtyDays(entry.expiresAt, now)) {
      violations.push(`${label} must expire within the next 30 days.`);
    }
  }
  return violations;
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function expiresWithinThirtyDays(value, now) {
  const expiry = new Date(value).getTime();
  const maximum = now.getTime() + 30 * 24 * 60 * 60_000;
  return Number.isFinite(expiry) && expiry > now.getTime() && expiry <= maximum;
}

async function main() {
  const ledger = JSON.parse(await readFile(
    `${root}/security/trivy-unfixed-exceptions.json`,
    "utf8",
  ));
  const reports = {};
  for (const argument of process.argv.slice(2)) {
    const separator = argument.indexOf("=");
    if (separator <= 0 || separator === argument.length - 1) {
      throw new Error(`Expected a target=report.json argument, received ${argument}.`);
    }
    const target = argument.slice(0, separator);
    const filename = argument.slice(separator + 1);
    reports[target] = JSON.parse(await readFile(filename, "utf8"));
  }
  if (Object.keys(reports).length === 0) {
    throw new Error("At least one target=report.json argument is required.");
  }
  const violations = evaluateTrivyReports(reports, ledger);
  if (violations.length > 0) {
    throw new Error(`Trivy exception verification failed:\n- ${violations.join("\n- ")}`);
  }
  process.stdout.write("Trivy reports contain no unapproved unfixed high or critical findings.\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
