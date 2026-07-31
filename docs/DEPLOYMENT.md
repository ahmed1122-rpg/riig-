# Production deployment

## Assumptions

This deployment profile is intentionally a modular monolith with image, PDF,
and export workers. It assumes one small product team, a TLS-terminating load balancer, and
managed PostgreSQL, Redis, S3-compatible storage, and SMTP. Kubernetes is
deliberately deferred until independent scaling or operational ownership makes
it necessary.

The `provider-readiness` GitHub environment is a release gate. Its protected
workflow must pass against deployment-owned object storage and a completed
isolated recovery manifest before production approval. Configure its
environment variables with the exact digest-qualified release references and
provider bucket settings. Store the latest signed recovery-manifest JSON in
the protected `RECOVERY_MANIFEST_JSON` secret and its Ed25519 public
verification key in `RECOVERY_SIGNING_PUBLIC_KEY_PEM`. Static
access keys are optional when the runner receives a workload identity. For AWS
OIDC, set `AWS_ROLE_ARN` and `AWS_REGION` on the protected environment and
leave the object-storage access/secret key pair unset. For another
S3-compatible provider, leave `AWS_ROLE_ARN` unset and provide both secrets;
the workflow rejects mixed or partial credential modes.

The initial recovery targets are RPO <= 15 minutes and RTO <= 4 hours. Confirm
these numbers with the business before launch and configure the managed
PostgreSQL service for point-in-time recovery accordingly.
Use the coordinated PostgreSQL/object-storage procedure in
[`runbooks/disaster-recovery.md`](runbooks/disaster-recovery.md); a
database-only restore does not satisfy these targets.

## Required services

- PostgreSQL 17 with TLS, daily backups, and point-in-time recovery.
- Redis with TLS and authentication.
- Private S3-compatible bucket with encryption and lifecycle policies.
- SMTP account dedicated to security messages.
- Stripe account only when `PAYMENT_MODE=live`.
- Reverse proxy or load balancer terminating HTTPS before port 8080.

The application never accepts card numbers. Stripe Checkout is hosted by Stripe,
subscription state is accepted only from signed webhooks, and account changes
use Stripe Customer Portal.

## Prepare configuration

1. Copy `.env.production.example` to `.env.production`.
2. Replace every `CHANGE_ME` or `REPLACE_WITH` value.
3. Generate `AUTH_ENCRYPTION_KEY` using `openssl rand -base64 32`.
4. Set `WEB_ORIGIN` and `PASSWORD_RESET_URL` to the public HTTPS origin.
5. Keep `PAYMENT_MODE=disabled` until the Stripe webhook is registered.
6. Keep `PDF_OCR_MODE=local`; the bundled Arabic model performs OCR inside the
   document worker and does not call an external document service.
7. Set `OBJECT_STORAGE_ENCRYPTION_MODE=sse-s3` when the provider accepts an
   explicit `AES256` request, or `bucket-default` when encryption is enforced
   by bucket policy. Both modes are verified after every write; an object that
   does not satisfy the configured mode is deleted and the operation fails.
   `none` is rejected in production and exists only for local MinIO without a
   KMS.
8. Prefer the cloud platform workload identity. On AWS, leave the three
   credential fields blank to use the SDK default provider chain. A custom
   S3-compatible endpoint requires both static keys and may include a session
   token.
9. Use no custom endpoint for AWS S3. Any custom production endpoint must be
   HTTPS.
10. Apply the private-bucket permissions and lifecycle requirements in
    [`OBJECT_STORAGE.md`](OBJECT_STORAGE.md). In particular, expire
    `artifacts/` after no more than two days and never blindly expire live
    `sources/` or `derived/`.
11. Store the completed environment in a secrets manager. Do not commit it.

When Stripe is enabled, configure:

- `PAYMENT_MODE=live`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- Webhook URL: `https://<public-host>/v1/billing/webhooks/stripe`
- Enable Checkout, Customer Portal, and subscription lifecycle events for the
  configured products and prices.

## Release

The `release-images` workflow builds each image once, publishes it to GHCR,
generates SBOM/provenance, scans it, signs the resulting digest with Cosign,
and uploads `release.env`. Copy its digest-qualified `RUNTIME_IMAGE_REF` and
`WEB_IMAGE_REF` values into the deployment environment. Production Compose
rejects missing references and does not contain build directives or tag
fallbacks.

```bash
node scripts/verify-release-environment.mjs .env.production
docker compose --env-file .env.production -f compose.production.yaml pull
docker compose --env-file .env.production -f compose.production.yaml up -d
docker compose --env-file .env.production -f compose.production.yaml ps
```

The `migrate` service applies additive SQL migrations before the API and workers
start. The web container exposes port 8080 and proxies `/v1` to the private API
service. Only the web port should be published.

Verify:

```bash
curl --fail https://<public-host>/healthz
curl --fail https://<public-host>/v1/health/live
curl --fail https://<public-host>/v1/health/ready
npm run verify:object-storage
```

Run the object-storage probe from a staging task with the same workload identity
and environment as the API/worker containers, not from a developer account.

Detailed worker events are bounded by `WORKER_EVENT_RETENTION_DAYS` (30 by
default). The separate `worker_duration_metrics` table retains monotonic
cumulative duration buckets, allowing Prometheus to derive p95 with
`histogram_quantile`.

Then run a smoke journey with a non-admin account: sign in, upload one AVIF or
PNG image, fill a transparent gap, separate a region, reorder layers, and export
that image as PSD and multi-page TIFF. Next, upload one scanned Arabic PDF,
navigate pages, mark a line, and export that PDF as both per-page and
full-document PSD. TIFF is an image-project export, not a PDF export.

## Scheduled retention maintenance

Run the idempotent one-shot maintenance task at least hourly using the
platform scheduler:

```bash
docker compose --env-file .env.production -f compose.production.yaml \
  --profile maintenance run --rm maintenance
```

It deletes expired upload and export bytes before marking their database rows
as purged. A storage failure leaves the row eligible for retry and makes the
command exit non-zero. It also removes expired sessions, MFA challenges,
password-reset tokens, idempotency keys, stale worker heartbeats, and old
terminal-job metadata according to the explicit retention variables. Audit and
usage-ledger defaults are 400 days; legal/compliance ownership must approve any
shorter value. Never apply this task to live `sources/` or `derived/` objects
that remain referenced by a ready source version or layer document.

## Security controls

- The API image runs as a non-root user and all application containers use a
  read-only filesystem with a bounded temporary directory.
- Cookies are Secure and HttpOnly in production.
- The public proxy enforces the 30 MiB request limit and security headers.
- PostgreSQL, Redis, S3, SMTP, and authentication secrets are injected at
  runtime and are not baked into images.
- Browser object transfers pass through the authenticated API. The bucket has
  no public access, and v1 emits no presigned object URLs.
- Source, derived-raster, and artifact reads fail closed when their bytes, size,
  or content type do not match the metadata stored in PostgreSQL.
- `TRUST_PROXY_HOPS=1` is correct only when exactly one trusted reverse proxy is
  in front of the web/API path. Adjust it to the real topology.
- Restrict database, Redis, and storage access to the application network or
  provider firewall.

## Scaling

Scale image and document workers independently. Do not increase document
concurrency until memory use has been measured with representative 30 MiB PDFs.
The database job claim uses row locking, so several worker replicas can safely
share the queue. Every processing/export job uses a renewable lease and bounded
retry; set `PROCESSING_LEASE_MS` and `EXPORT_LEASE_MS` above the normal p99 job
duration while retaining heartbeat headroom.

Scrape `http://api:4000/internal/metrics` only from the private application
network. It exposes HTTP and job-duration histograms, queue depth/age, recent
retry and lease-loss counts, worker heartbeat gauges, and aggregate dependency
readiness. Load `deploy/prometheus-alerts.yml` into the monitoring system. The
CPU/RAM alerts in that file consume the standard container runtime/cAdvisor
series and compare usage with the Compose ceilings. The public Nginx
configuration deliberately exposes no `/internal` location.

## External release gates and deliberately deferred scope

- Kubernetes and microservices: no current team or scaling need justifies them.
- Paymob live processing: requires a verified merchant account, credentials,
  signed-callback contract, and a dedicated adapter/test fixture.
- Administrator-triggered refunds: requires a business approval policy and an
  explicit provider operation; it is not exposed as a decorative admin button.
- Restoring an older server revision with one click: current edits use optimistic
  revisions and derived assets are non-destructive, but applied-review rollback
  remains a separate feature.
- Adobe Golden tests, Arabic OCR accuracy benchmarks, and live Stripe merchant
  tests require external applications/accounts and must pass in staging.
- The chosen object-storage provider, workload identity, bucket encryption,
  lifecycle policy, and end-to-end upload/export journey must pass in staging.

These are explicit launch gates when the corresponding capability is marketed.
