# Security policy

Do not report vulnerabilities in public issues. Share the affected endpoint,
reproduction steps, impact, release SHA, and request ID through the private
security contact configured for the deployment. Do not attach real uploaded
content, credentials, cookies, payment data, or recovery material.

## Supported production profile

- Authentication includes opaque secure sessions, password reset through the
  durable email outbox, TOTP MFA and one-time recovery codes, RBAC, audit
  records, versioned legal consent, account export, and resumable deletion.
- Production configuration fails closed unless it uses PostgreSQL and
  TLS-enabled Redis, private versioned and encrypted S3-compatible storage, TLS-protected
  SMTP, separate processing/export workers, secure cookies, and an exact release
  SHA. Multiple API replicas are supported only with the shared PostgreSQL and
  Redis production profile; memory repositories remain local single-process
  tooling.
- Payments default to disabled. Sandbox providers are development-only and are
  rejected in production. `PAYMENT_MODE=live` uses Stripe-hosted Checkout and
  Customer Portal plus raw-body signature verification for Stripe webhooks.
  Enable it only after the merchant account, webhook endpoint, return URLs, and
  secret rotation have passed protected staging validation.
- Regional OCR remains disabled until a fresh sealed holdout satisfies the
  documented accuracy gate. Ordinary PDF processing and export do not depend on
  that optional capability.
- Production must terminate TLS at the trusted edge, set the documented proxy
  hop count, keep all provider credentials in a deployment secret store, and
  deploy only digest-qualified images from a protected release workflow.

## Disclosure and evidence handling

Never include passwords, session cookies, uploaded content, book text, payment
tokens, provider secrets, TOTP seeds, recovery codes, or raw recovery manifests
in reports or logs. Retain only the minimum redacted reproduction and the
request/job correlation identifiers needed to investigate the issue.

Declare and coordinate suspected security, privacy, integrity, payment, or
supply-chain events with
[`docs/runbooks/incident-response.md`](docs/runbooks/incident-response.md).
Security-sensitive uncertainty is SEV1 until evidence supports a lower
classification; preserve redacted evidence and exact release identity before
containment or rollback.
