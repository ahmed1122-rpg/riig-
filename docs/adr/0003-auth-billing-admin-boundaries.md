# ADR 0003: Authentication, billing, and admin boundaries

## Context

Authentication, payments, and administrative actions have different security and audit requirements from creative processing.

## Decision

- Use opaque server-side sessions in HttpOnly cookies.
- Store only a SHA-256 digest of the session token.
- Keep password hashing behind an asynchronous scrypt adapter.
- Keep payment providers behind `PaymentProvider`.
- Make webhook/provider confirmation the future live payment authority.
- Require explicit roles and audit reasons for administrative mutations.
- Keep the admin UI separate from the creator shell.

## Consequences

- A provider can be replaced without changing subscription business rules.
- UI role checks improve usability but never replace API authorization.
- In-memory repositories remain non-production and must be replaced by PostgreSQL before multi-instance deployment.
- MFA, password reset delivery, live providers, and signed webhooks remain required before production authentication/payment launch.

