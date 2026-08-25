# Dependency security policy

High and critical vulnerabilities block pull requests and releases. An exception is allowed only when no fixed version exists and the risk has a named owner, a public or internal tracking URL, a concrete mitigation, and an expiry of at most 30 days.

`security/dependency-audit-exceptions.json` is the only exception ledger for npm advisories. Each entry must contain `package`, `advisorySource`, `severity`, `justification`, `expiresAt`, `trackingUrl`, and `approvedBy`. Expired, malformed, or unused exceptions fail the audit verifier.

`security/trivy-unfixed-exceptions.json` records temporary unfixed container findings using the same ownership and expiry policy. CI first blocks every fixable high or critical finding, then captures complete JSON reports and rejects any unfixed finding that is not matched to its target, CVE, package, severity, mitigation, approver, tracker, and expiry in the ledger. The same verifier runs again against the published immutable digests before signing.

Removing the affected dependency or upgrading to a fixed version is preferred. Exceptions must never cover malware, leaked credentials, actively exploited vulnerabilities, remote code execution on an exposed path, or vulnerabilities with an available compatible fix.
