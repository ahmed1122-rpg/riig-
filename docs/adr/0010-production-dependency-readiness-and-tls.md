# ADR 0010: Production dependency readiness and TLS

## Context

The API directly delivers password-reset messages through SMTP. PostgreSQL,
Redis, object storage, and SMTP are configured from one protected production
environment file. Marking SMTP as non-critical without durable delivery would
let password-reset requests appear successful while messages are silently lost.

PostgreSQL providers commonly return either `postgresql:` or `postgres:` URLs.
The application must accept both while continuing to fail closed when transport
security is absent.

## Decision

- Keep SMTP in startup and readiness checks while reset delivery is synchronous.
- Keep the public reset response indistinguishable for known and unknown
  accounts; surface delivery failures through readiness and operational alerts.
- Do not remove SMTP from readiness until a durable outbox, retry worker,
  delivery status, and dead-letter recovery procedure exist.
- Accept both PostgreSQL URL schemes in configuration validation.
- Require an explicit TLS `sslmode` in production. Use `verify-full` in the
  production template so hostname and certificate verification are explicit.
- Run migration, API, worker, and worker-health commands from the same protected
  environment so none can silently select a weaker database transport.

## Consequences

A central SMTP outage can make all API replicas unready. This is an intentional
fail-fast trade-off until durable delivery exists; the production SMTP provider
therefore needs suitable availability and monitoring. Supporting both database
URL schemes removes provider-specific friction without weakening validation.

The `pg` dependency must be reviewed before its next major upgrade because SSL
mode compatibility semantics can change. Production should continue to prefer
`verify-full`, including the appropriate CA configuration when a private CA is
used.
