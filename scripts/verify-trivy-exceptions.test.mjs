import assert from "node:assert/strict";
import test from "node:test";
import { evaluateTrivyReports } from "./verify-trivy-exceptions.mjs";

const now = new Date("2026-08-20T12:00:00.000Z");
const report = (vulnerabilities) => ({ Results: [{ Vulnerabilities: vulnerabilities }] });
const exception = {
  target: "runtime",
  vulnerabilityId: "CVE-2026-1000",
  packages: ["unsafe-os-package"],
  severity: "high",
  justification: "The affected executable is never invoked and the container is read-only and non-root.",
  expiresAt: "2026-09-01T00:00:00.000Z",
  trackingUrl: "https://security-tracker.debian.org/tracker/CVE-2026-1000",
  approvedBy: "security-owner",
};

test("accepts an owned current exception and ignores a fixable finding", () => {
  const violations = evaluateTrivyReports({
    runtime: report([
      { VulnerabilityID: "CVE-2026-1000", PkgName: "unsafe-os-package", Severity: "HIGH" },
      { VulnerabilityID: "CVE-2026-2000", PkgName: "fixable", Severity: "CRITICAL", FixedVersion: "2.0.0" },
    ]),
  }, { schemaVersion: 1, exceptions: [exception] }, now);
  assert.deepEqual(violations, []);
});

test("rejects unapproved, wrong-package, and stale exceptions", () => {
  const violations = evaluateTrivyReports({
    runtime: report([
      { VulnerabilityID: "CVE-2026-1000", PkgName: "different-package", Severity: "HIGH" },
      { VulnerabilityID: "CVE-2026-3000", PkgName: "new-package", Severity: "CRITICAL" },
    ]),
  }, { schemaVersion: 1, exceptions: [exception] }, now);
  assert.match(violations.join("\n"), /does not approve package different-package/u);
  assert.match(violations.join("\n"), /CVE-2026-3000 has an unapproved critical/u);
  assert.match(violations.join("\n"), /stale or unused/u);
});

test("rejects expired or materially incomplete exception records", () => {
  const violations = evaluateTrivyReports({}, {
    schemaVersion: 1,
    exceptions: [{ ...exception, expiresAt: "2026-08-19T00:00:00.000Z", justification: "short" }],
  }, now);
  assert.match(violations.join("\n"), /concrete mitigation/u);
  assert.match(violations.join("\n"), /expire within/u);
});
