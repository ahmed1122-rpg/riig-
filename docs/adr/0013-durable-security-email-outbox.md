# ADR 0013: Durable security-email outbox

## Status

Accepted on 2026-08-01.

## Context

Sending a password-reset email directly after storing its token creates an
unrecoverable gap: the token may commit while SMTP fails, or email may be sent
while the token transaction rolls back.

## Decision

The password-reset token and a minimal email delivery row are inserted in one
PostgreSQL transaction. API replicas claim rows with `FOR UPDATE SKIP LOCKED`,
use a renewable bounded lease, and retry transient SMTP failures with capped
exponential backoff. Delivery is at-least-once because SMTP provides no portable
idempotency key.

Recipient and reset URL are cleared after success, expiry, or terminal failure.
Only a stable error code is stored. Retention removes terminal rows after seven
days.

## Consequences

- A committed reset token always has durable delivery intent.
- Restarts and replica failures do not lose pending security mail.
- A rare duplicate email is possible after SMTP accepts a message but the
  worker loses its database lease before acknowledgement; reset tokens remain
  single-use and expiration bounded.
- Operators can observe retries without persisting provider secrets or reset
  URLs in logs.

## Verification

Integration tests inject a transaction failure, verify rollback, claim the
committed row, and verify sensitive-field scrubbing. Unit tests cover success,
idle polling, retry, terminal failure, lost acknowledgement, start, and stop.
