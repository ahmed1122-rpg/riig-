# Auth, billing, and admin API

## Authentication

- `POST /v1/auth/register`
- `POST /v1/auth/email/verify`
- `POST /v1/auth/email/resend`
- `POST /v1/auth/admin-bootstrap`
- `POST /v1/auth/login`
- `POST /v1/auth/mfa/challenge`
- `POST /v1/auth/mfa/setup`
- `POST /v1/auth/mfa/setup/confirm`
- `POST /v1/auth/mfa/disable`
- `POST /v1/auth/password-reset/request`
- `POST /v1/auth/password-reset/confirm`
- `POST /v1/auth/password/change`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`

Sessions use an opaque `motionprep_session` cookie with `HttpOnly`,
`SameSite=Lax`, and `Secure` in production. Registration requires the exact
current terms/privacy versions. Production registration remains pending until
the one-use email token is consumed; resend is deliberately non-enumerating and
invalidates every earlier token. The bootstrap route accepts only the configured
email and token digest, is serialized in PostgreSQL, and becomes permanently
unavailable after the first administrator exists. Remove its configuration
immediately after enrollment and require MFA for the created account.

Persistent deployments encrypt MFA secrets with the active key from the
bounded authentication keyring. Previous keys are decrypt-only during a
rotation window; new ciphertext and recovery-code hashes always use the active
key ID.

## Account privacy

- `GET /v1/account/export`
- `DELETE /v1/account`

Account export is session-bound. Deletion revokes sessions first, rejects a
live subscription, deletes owned objects through the durable cleanup workflow,
and anonymizes retained billing/audit identity rather than silently reporting a
partial deletion as complete.

## Billing

- `GET /v1/billing/config`
- `GET /v1/billing/subscription`
- `GET /v1/billing/checkouts/:checkoutId`
- `POST /v1/billing/checkouts`
- `POST /v1/billing/portal`
- `POST /v1/billing/checkouts/:checkoutId/complete-sandbox`
- `POST /v1/billing/webhooks/:providerId`

The sandbox completion route is available only in sandbox mode and is hidden in
live/disabled modes. Live mode uses the built-in Stripe adapter for hosted
Checkout, Customer Portal, and raw-body signed webhook verification. Provider
events are deduplicated and ordered before subscription state is applied. Real
payments remain an external launch gate until the configured Stripe account and
webhook have passed protected staging validation.

## Admin

- `GET /v1/admin/overview`
- `GET /v1/admin/users`
- `PATCH /v1/admin/users/:userId/access`
- `GET /v1/admin/audit`
- `GET /v1/admin/processing`
- `GET /v1/admin/exports`
- `POST /v1/admin/processing/:jobId/retry`
- `POST /v1/admin/exports/:jobId/retry`
- `GET /v1/admin/system`
- `GET /v1/admin/billing`

Access changes require an admin session and a reason of at least 10 characters. Creator requests receive `403`.

Terminal processing and export retries require an admin session and an audited
reason. A retry is accepted only while the job is `failed`, its immutable ready
source remains current and, when exporting, the exact document revision is still
retained. The repository resets bounded attempt and lease state atomically; API
clients must never edit queue rows directly.
