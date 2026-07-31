# ADR 0008: Production containers and hosted payments

## Context

MotionPrep needs a repeatable first production deployment without introducing
Kubernetes or handling raw payment-card data. The API and two worker processes
share domain packages but scale independently.

## Decision

- Build one non-root Node.js runtime image for the API, migrations, and both
  workers, using different commands.
- Build the React application into a separate Nginx image. Nginx serves the SPA
  and proxies `/v1` to the private API service.
- Use managed PostgreSQL, Redis, S3-compatible storage, and SMTP in production.
- Run additive migrations as a one-shot service before API/workers start.
- Use Stripe-hosted Checkout and accept payment activation only from a verified,
  idempotently handled webhook.
- Use Stripe-hosted Customer Portal and consume subscription lifecycle events
  for renewal, past-due, scheduled cancellation, and cancellation.
- Keep production payments disabled until credentials and the webhook endpoint
  are configured.

## Consequences

This is simpler to operate than a service mesh or Kubernetes deployment and
keeps card data outside MotionPrep. API and workers can still be replicated
independently. The shared runtime image is larger than narrowly tailored images,
but avoids dependency drift between processing roles.

Paymob and administrator-triggered refunds remain separate product decisions.
Local OCR and PDF-to-PSD run inside the document path; Adobe Golden tests and a
live Stripe merchant smoke test remain external release gates.
