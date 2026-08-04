# Incident response runbook

Use this runbook for production or staging incidents that affect availability,
data integrity, authentication, billing, privacy, or the release supply chain.
It coordinates the more specific recovery runbooks; it does not replace them.

## Safety rules

- Do not paste passwords, cookies, authorization headers, MFA material, reset
  links, payment data, uploaded content, or provider credentials into the
  incident channel or evidence manifest.
- Preserve request IDs, correlation IDs, job IDs, provider event IDs, the exact
  release SHA, and digest-qualified runtime/web image references.
- Prefer containment that is reversible: disable a feature, stop one worker
  type, or roll back application images. Do not delete queues, rewrite job
  state, make a bucket public, disable TLS, or reverse a database migration.
- Treat suspected data exposure, integrity loss, credential compromise, or
  payment misapplication as a security incident until disproved.

## Severity and response targets

| Severity | Definition | Acknowledge | Initial update |
|---|---|---:|---:|
| SEV1 | Confirmed or suspected data exposure/integrity loss, payment corruption, supply-chain compromise, or complete loss of a core workflow | 15 minutes | 30 minutes |
| SEV2 | Material degradation of upload, processing, review, export, authentication, email, or a managed dependency with a safe durable backlog | 30 minutes | 60 minutes |
| SEV3 | Limited impact with a workaround and no evidence of data, security, or billing risk | 4 hours | Same business day |

Escalate immediately if impact grows or evidence becomes uncertain. A SEV1
cannot be downgraded until the incident commander records the evidence used to
exclude data exposure, integrity loss, and payment corruption.

## Roles

Assign named handles at declaration time. One person may hold several roles for
a small team, but the incident commander must remain the single decision owner.

- **Incident commander:** owns severity, timeline, containment approval, and
  closure.
- **Technical lead:** investigates, executes reversible changes, and records
  commands/results without secrets.
- **Communications lead:** publishes scheduled internal/customer updates and
  coordinates legal/security notification when required.

## Response sequence

1. **Detect and declare.** Record UTC detection and acknowledgement times,
   source alert, affected workflows, environment, release SHA, image digests,
   and the three roles. Open an incident record even if the alert later proves
   false.
2. **Bound the impact.** Check `/v1/health/ready`, private metrics, logs by
   request/job correlation, provider status, queue/outbox age, and the last
   release window. Classify data integrity and exposure as `unknown` until
   verified.
3. **Contain.** Stop the smallest unsafe surface. Use
   `PAYMENT_MODE=disabled` for checkout risk, stop only the affected worker for
   processing/export risk, or use the digest-qualified application rollback.
4. **Recover.** Follow the matching runbook below. Preserve durable queues and
   outbox rows; let bounded retry/reconciliation converge after the cause is
   fixed.
5. **Verify.** Require readiness stability plus one authenticated upload,
   processing, exact-revision review approval, export, and verified download
   when the incident touched a core workflow. Verify subscription/audit state
   for billing incidents and object/database alignment for recovery incidents.
6. **Observe.** Keep the service healthy and queue/outbox age at baseline for at
   least 15 minutes. SEV1 incidents may require a longer observation window set
   by the incident commander.
7. **Close.** Validate and sign the redacted incident manifest, assign dated
   follow-ups, and schedule the post-incident review.

## Alert and scenario routing

- `MotionPrepDependencyUnavailable`, `MotionPrepObjectStorageUnavailable`,
  `MotionPrepSmtpUnavailable`, `MotionPrepOperationalMetricsUnavailable`, and
  `MotionPrepEmailOutboxBacklog`: use
  [`production-dependency-recovery.md`](production-dependency-recovery.md).
- `MotionPrepWorkerMissing`, `MotionPrepQueueTooOld`, `MotionPrepLeaseLoss`,
  `MotionPrepRetryStorm`, and `MotionPrepTerminalJobFailuresHigh`: use
  [`processing-job-recovery.md`](processing-job-recovery.md).
- `MotionPrepUploadIntegrityFailure`,
  `MotionPrepUploadReconciliationFailures`, and
  `MotionPrepUploadReconciliationStalled`: use
  [`upload-export.md`](upload-export.md) and treat integrity uncertainty as
  SEV1.
- `MotionPrepHttpErrorRateHigh`, `MotionPrepApiLatencyHigh`, container resource
  alerts, or a bad release: use
  [`production-release-and-rollback.md`](production-release-and-rollback.md).
- Database or object-store restore: use
  [`disaster-recovery.md`](disaster-recovery.md) and retain the separately
  signed recovery manifest.
- `MotionPrepAuthenticationRejectionsHigh`, suspected account compromise, or
  privacy exposure: contain at the edge/auth boundary, rotate affected secrets,
  revoke sessions where necessary, and start the legal notification assessment.

## Evidence manifest

Copy `incident-manifest.example.json` into the protected incident evidence
store, redact it, replace every example value, and run:

```bash
npm run verify:incident -- path/to/incident-manifest.json
```

To cryptographically verify the attestation as well:

```bash
node scripts/verify-incident-manifest.mjs path/to/incident-manifest.json \
  --public-key path/to/incident-ed25519-public-key.pem
```

The manifest must contain chronological UTC timestamps, response roles, exact
release identity, affected services, triggered alerts, impact classification,
containment/recovery/verification actions, HTTPS evidence links, a stable
monitoring window, dated follow-ups, and Ed25519 attestation metadata. Store the
private signing key only in the incident evidence system; never in the
repository or deployment host.

## Post-incident review

Hold the review within five business days for SEV1/SEV2. Record the triggering
condition, why existing controls did or did not detect it, the customer/data
impact, the recovery decision, measured response times, and owned follow-ups.
Test permanent fixes with the relevant fault, topology, browser, provider, or
recovery gate. Do not close a follow-up merely because the service recovered.
