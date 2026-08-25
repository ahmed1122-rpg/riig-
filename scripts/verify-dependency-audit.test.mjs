import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateAuditReport,
  validateAuditExecution,
} from "./verify-dependency-audit.mjs";

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

const validExecutionReport = {
  auditReportVersion: 2,
  vulnerabilities: {},
  metadata: {
    vulnerabilities: {
      info: 0,
      low: 0,
      moderate: 0,
      high: 0,
      critical: 0,
      total: 0,
    },
  },
};

test("accepts success with no findings and failure with a matching blocking finding", () => {
  assert.deepEqual(
    validateAuditExecution({ status: 0, signal: null }, validExecutionReport),
    [],
  );
  const blockingReport = {
    ...validExecutionReport,
    vulnerabilities: {
      vulnerablePackage: { severity: "high" },
    },
    metadata: {
      vulnerabilities: {
        ...validExecutionReport.metadata.vulnerabilities,
        high: 1,
        total: 1,
      },
    },
  };
  assert.deepEqual(
    validateAuditExecution({ status: 1, signal: null }, blockingReport),
    [],
  );
});

test("rejects status 1 when npm reports no blocking findings", () => {
  const violations = validateAuditExecution(
    { status: 1, signal: null },
    validExecutionReport,
  );
  assert.match(violations.join("\n"), /without any High or Critical finding/u);
});

test("rejects negative, fractional, and vulnerability-inconsistent counts", () => {
  const violations = validateAuditExecution(
    { status: 0, signal: null },
    {
      ...validExecutionReport,
      vulnerabilities: {
        vulnerablePackage: { severity: "moderate" },
      },
      metadata: {
        vulnerabilities: {
          ...validExecutionReport.metadata.vulnerabilities,
          low: -1,
          moderate: 0.5,
          total: 0,
        },
      },
    },
  );
  assert.match(violations.join("\n"), /low must be a non-negative integer/u);
  assert.match(violations.join("\n"), /moderate must be a non-negative integer/u);
  assert.match(violations.join("\n"), /moderate count does not match/u);
  assert.match(violations.join("\n"), /total count does not match/u);
});

test("rejects status 0 when blocking findings are present", () => {
  const violations = validateAuditExecution(
    { status: 0, signal: null },
    {
      ...validExecutionReport,
      vulnerabilities: { vulnerablePackage: { severity: "critical" } },
      metadata: {
        vulnerabilities: {
          ...validExecutionReport.metadata.vulnerabilities,
          critical: 1,
          total: 1,
        },
      },
    },
  );
  assert.match(violations.join("\n"), /status 0 despite High or Critical/u);
});

test("fails closed on registry errors even when npm emits valid JSON", () => {
  const violations = validateAuditExecution(
    { status: 1, signal: null },
    {
      error: {
        message: "request to registry failed",
      },
    },
  );
  assert.match(violations.join("\n"), /reported an error/u);
  assert.match(violations.join("\n"), /auditReportVersion 2/u);
  assert.match(violations.join("\n"), /vulnerabilities object/u);
  assert.match(violations.join("\n"), /metadata\.vulnerabilities/u);
});

test("fails closed on signals, unexpected statuses, and incomplete schemas", () => {
  const violations = validateAuditExecution(
    { status: null, signal: "SIGTERM" },
    { auditReportVersion: 2, vulnerabilities: [] },
  );
  assert.match(violations.join("\n"), /terminated by signal SIGTERM/u);
  assert.match(violations.join("\n"), /unexpected status unknown/u);
  assert.match(violations.join("\n"), /vulnerabilities object/u);
  assert.match(violations.join("\n"), /metadata\.vulnerabilities/u);
});
