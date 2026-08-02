# Runbook — Production dependency and delivery recovery

Use this runbook for provider-specific readiness, email delivery, and
authentication anomaly alerts. Keep `/internal/metrics` private and preserve
the request, job, release, and provider identifiers collected during the
incident.

## Object storage unavailable

1. Confirm `motionprep_dependency_ready{dependency="object_storage"}` is zero
   from the private scrape target and compare it with `/v1/health/ready`.
2. Verify DNS, TLS certificate validity, regional endpoint, bucket identity,
   and the API role or short-lived credentials. Do not switch to a public
   bucket or disable TLS, encryption, or versioning to restore service.
3. Run `npm run verify:object-storage` with the same protected environment.
   The probe must write, verify, read, and delete only its isolated test key.
4. Keep queued processing and export jobs durable while storage is unavailable.
   If retry volume grows, reduce worker concurrency or stop workers cleanly;
   never delete queued jobs.
5. Resolve the provider failure, verify readiness, then restart workers with
   reduced concurrency and observe queue age before restoring normal capacity.

## SMTP unavailable or outbox backlog

1. Compare `motionprep_dependency_ready{dependency="smtp"}` with
   `motionprep_email_outbox_messages` and
   `motionprep_email_outbox_oldest_queued_seconds`.
2. Verify DNS, STARTTLS/TLS, credentials, sender authorization, provider quota,
   suppression lists, and delivery status at the provider. Never log reset URLs
   or copy recipients into incident notes.
3. Preserve the durable outbox. The dispatcher uses bounded retries and moves
   exhausted or expired deliveries to `failed`; do not update those rows to
   `sent` manually.
4. After recovery, allow queued messages to drain, confirm the oldest age falls,
   and sample provider delivery evidence. Expired password-reset messages must
   remain failed; users should request a new reset.

## Authentication rejection anomaly

1. Break down the rejection rate by route, status, source network, and request
   identifier in the reverse proxy and API logs. Do not log credentials,
   session cookies, MFA secrets, or reset tokens.
2. Confirm Redis-backed login lockout and global rate limiting are healthy.
3. Distinguish a product regression from credential stuffing using the release
   time, user-agent distribution, account distribution, and WAF evidence.
4. For abuse, tighten the edge rate policy or block the source at the WAF while
   preserving normal account recovery. For a regression, stop rollout and use
   the digest-qualified rollback procedure.

## Retry storm or terminal job failures

Follow `processing-job-recovery.md`. The durable `failed` state is the
dead-letter boundary for the PostgreSQL queues. A replay is allowed only after
the cause is fixed, the immutable source and document revision are verified,
no active job conflicts, and an authenticated administrative action records
the reason in the audit log.

## Closure evidence

Record the UTC incident window, alert names, release digest, affected provider,
queue and outbox recovery graphs, remediation, and follow-up owner. Close the
incident only after readiness stays healthy and queue/outbox age returns to its
normal baseline for at least 15 minutes.
