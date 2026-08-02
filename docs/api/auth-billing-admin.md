# Auth, billing, and admin API

## Authentication

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`

Sessions use an opaque `motionprep_session` cookie with `HttpOnly`, `SameSite=Lax`, and `Secure` in production.

## Billing

- `GET /v1/billing/subscription`
- `POST /v1/billing/checkouts`
- `POST /v1/billing/checkouts/:id/complete-sandbox`

The sandbox completion route is unavailable when `PAYMENT_MODE=live`. Live providers and provider-specific signed webhooks must be added before accepting real payments.

## Admin

- `GET /v1/admin/overview`
- `GET /v1/admin/users`
- `PATCH /v1/admin/users/:id/access`
- `GET /v1/admin/audit`
- `GET /v1/admin/processing`
- `POST /v1/admin/processing/:jobId/retry`
- `POST /v1/admin/exports/:jobId/retry`
- `GET /v1/admin/system`

Access changes require an admin session and a reason of at least 10 characters. Creator requests receive `403`.

Terminal processing and export retries require an admin session and an audited
reason. A retry is accepted only while the job is `failed`, its immutable ready
source remains current, and—when exporting—the exact document revision is still
retained. The repository resets bounded attempt and lease state atomically; API
clients must never edit queue rows directly.
