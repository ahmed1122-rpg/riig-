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

Access changes require an admin session and a reason of at least 10 characters. Creator requests receive `403`.

