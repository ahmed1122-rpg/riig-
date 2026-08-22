import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuditReport } from "./verify-dependency-audit.mjs";

const now = new Date("2026-08-20T12:00:00.000Z");

test("rejects an unapproved high vulnerability", () => {
  const violations = evaluateAuditReport({
    vulnerabilities: {
      unsafe: {
        severity: "high",
        via: [{ source: 123, severity: "high" }],
      },
    },
  }, { schemaVersion: 1, exceptions: [] }, now);
  assert.match(violations.join("\n"), /unsafe has an unapproved high/u);
});

test("accepts a current, owned, advisory-specific exception", () => {
  const violations = evaluateAuditReport({
    vulnerabilities: {
      unsafe: {
        severity: "high",
        via: [{ source: 123, severity: "high" }],
      },
    },
  }, {
    schemaVersion: 1,
    exceptions: [{
      package: "unsafe",
      advisorySource: 123,
      severity: "high",
      justification: "The vulnerable path is disabled at the network boundary.",
      expiresAt: "2026-09-01T00:00:00.000Z",
      trackingUrl: "https://example.test/security/123",
      approvedBy: "security-owner",
    }],
  }, now);
  assert.deepEqual(violations, []);
});

test("rejects expired and unused exceptions", () => {
  const violations = evaluateAuditReport({ vulnerabilities: {} }, {
    schemaVersion: 1,
    exceptions: [{
      package: "unused",
      advisorySource: 456,
      severity: "critical",
      justification: "Temporary mitigation documented for a removed dependency.",
      expiresAt: "2026-08-19T00:00:00.000Z",
      trackingUrl: "https://example.test/security/456",
      approvedBy: "security-owner",
    }],
  }, now);
  assert.match(violations.join("\n"), /expire within/u);
  assert.match(violations.join("\n"), /stale or unused/u);
});
