# Production deployment

## Assumptions

This deployment profile is intentionally a modular monolith with image, PDF,
export, and optional Character workers. It assumes one small product team, a TLS-terminating load balancer, and
managed PostgreSQL, Redis, S3-compatible storage, and SMTP. Kubernetes is
deliberately deferred until independent scaling or operational ownership makes
it necessary.

The API publishes its machine-readable OpenAPI 3.1 document at
`/v1/openapi.json`. The document is public by design, contains no credentials,
and is generated from the routes registered by the running release so clients
can verify the deployed surface instead of relying on a stale checked-in copy.
The web client also reads `/v1/capabilities` before enabling gated tools. A
missing or malformed capability response disables those tools rather than
assuming they are available.

The `provider-readiness` GitHub environment is a release gate. Its protected
workflow must pass against deployment-owned object storage and a completed
isolated recovery manifest before production approval. Configure its
environment variables with `RELEASE_GIT_SHA`, the matching immutable
`RELEASE_TAG`, and the exact digest-qualified release references. Every
readiness workflow checks out that SHA with tag history, rejects a dirty or
mismatched checkout, and verifies both repository-bound Cosign identities
before running local scripts. Configure the provider bucket settings and store
the latest signed recovery-manifest JSON in
the protected `RECOVERY_MANIFEST_JSON` secret and its Ed25519 public
verification key in `RECOVERY_SIGNING_PUBLIC_KEY_PEM`. Static
access keys are optional when the runner receives a workload identity. For AWS
OIDC, set `AWS_ROLE_ARN` and `AWS_REGION` on the protected environment and
leave the object-storage access/secret key pair unset. For another
S3-compatible provider, leave `AWS_ROLE_ARN` unset and provide both secrets;
the workflow rejects mixed or partial credential modes.

Before a release exists, run the separate `staging-readiness` workflow on
`main`. It performs live, non-destructive connectivity checks against
TLS-protected PostgreSQL, Redis, SMTP, and S3. Store `DATABASE_URL`,
`REDIS_URL`, `SMTP_USER`, and `SMTP_PASSWORD` as protected environment secrets;
store the non-secret SMTP and bucket coordinates as environment variables.
This preflight deliberately does not accept or waive recovery evidence. The
full `provider-readiness` gate continues to require the signed isolated restore
manifest when disaster-recovery testing resumes.

The initial recovery targets are RPO <= 15 minutes and RTO <= 4 hours. Confirm
these numbers with the business before launch and configure the managed
PostgreSQL service for point-in-time recovery accordingly.
Use the coordinated PostgreSQL/object-storage procedure in
[`runbooks/disaster-recovery.md`](runbooks/disaster-recovery.md); a
database-only restore does not satisfy these targets.

Before a public launch, assign the incident roles and alert destinations in
[`runbooks/incident-response.md`](runbooks/incident-response.md). Every staging
drill or production incident must retain a redacted, chronologically valid
incident manifest. `npm run verify:incident -- <manifest.json>` enforces exact
release identity, response targets, evidence links, a stable observation
window, owned follow-ups, and Ed25519 attestation metadata.

Use `/healthz` only for Nginx process liveness. Load balancers and canary gates
must use `/readyz`, which proxies the API dependency and release-identity
readiness contract. Prometheus must alert both when the API target is down and
when application metrics disappear; dependency metrics alone cannot detect a
dead scrape target.

## Required services

- PostgreSQL 17 with TLS, daily backups, and point-in-time recovery.
- Redis with TLS and authentication.
- Private S3-compatible bucket with encryption and lifecycle policies.
- SMTP account dedicated to security messages.
- Stripe account only when `PAYMENT_MODE=live`.
- A load balancer terminating HTTPS before port 8080, with a stable private
  source CIDR and controlled `X-Forwarded-For`/`X-Forwarded-Proto` behavior.

The application never accepts card numbers. Stripe Checkout is hosted by Stripe,
subscription state is accepted only from signed webhooks, and account changes
use Stripe Customer Portal.

## Prepare configuration

1. Copy `.env.production.example` to `.env.production`. This is the Compose
   control plane only; it must contain release coordinates and paths, never
   application credentials.
2. Create the workload secret files from
   `.env.production.api.example`, `.env.production.migrate.example`,
   `.env.production.maintenance.example`, `.env.production.worker.example`,
   and `.env.production.worker-character.example`. Copy the ordinary worker
   template separately to `.env.production.worker-media`,
   `.env.production.worker-document`, and `.env.production.worker-export`.
   Replace every `CHANGE_ME` or `REPLACE_WITH` value and keep all files outside
   source control.
3. Set `RELEASE_GIT_SHA` to the exact 40-character commit SHA recorded in the
   signed release artifact. Readiness publishes this identity so staging can
   prove that the tested source is the deployed source.
4. Give migrations a dedicated TLS PostgreSQL URL in
   `MIGRATION_DATABASE_URL`. Its role must own/apply schema changes and must
   not be the API runtime role. Give the API, maintenance process, and every
   worker different least-privilege database identities.
5. Generate a 32-byte key for `AUTH_ENCRYPTION_KEYRING`, select its ID with
   `AUTH_ENCRYPTION_ACTIVE_KEY_ID`, and retain at most four previous keys while
   rotating. `AUTH_ENCRYPTION_KEY` is accepted only as a temporary legacy-v1
   decrypt key during the first rotation; remove it after a verified rotation
   and recovery drill.
6. Set `WEB_ORIGIN`, `PASSWORD_RESET_URL`, and `EMAIL_VERIFICATION_URL` to the
   public HTTPS origin. Production requires `EMAIL_VERIFICATION_REQUIRED=true`.
   If the first administrator must be created, deploy a single-use random token
   only as its SHA-256 digest in `ADMIN_BOOTSTRAP_TOKEN_HASH`, constrain
   `ADMIN_BOOTSTRAP_EMAIL`, complete the bootstrap, enroll MFA, then remove both
   variables and redeploy.
7. Keep `PAYMENT_MODE=disabled` until the Stripe webhook is registered.
8. Keep `PDF_OCR_MODE=local`; the bundled Arabic model performs OCR inside the
   document worker and does not call an external document service. Keep
   `PDF_REGION_OCR_ENABLED=false` until a newly sealed independent holdout
   reaches CER <= 25%. Ordinary PDF ingestion, page tools, and export remain
   available while regional OCR is disabled.
9. Set `OBJECT_STORAGE_ENCRYPTION_MODE=sse-s3` when the provider accepts an
   explicit `AES256` request, or `bucket-default` when encryption is enforced
   by bucket policy. Both modes are verified after every write; an object that
   does not satisfy the configured mode is deleted and the operation fails.
   `none` is rejected in production and exists only for local MinIO without a
   KMS.
10. Prefer the cloud platform workload identity. On AWS, leave the three
   credential fields blank to use the SDK default provider chain. A custom
   S3-compatible endpoint requires both static keys and may include a session
   token.
11. Use no custom endpoint for AWS S3. Any custom production endpoint must be
   HTTPS.
12. Apply the private-bucket permissions and lifecycle requirements in
    [`OBJECT_STORAGE.md`](OBJECT_STORAGE.md). In particular, expire
    `artifacts/` after no more than two days and never blindly expire live
    `sources/` or `derived/`.
13. Store every completed workload file in a secrets manager. The production
    launcher rejects reused env files, workload identities, database users, or
    explicit S3 credentials. Do not commit any of them.
14. Keep `CHARACTER_RIG_ENABLED=false` by default. To enable the optional
    identity-preserving pipeline, configure the private HTTPS inference
    endpoint and secret, pass the Character benchmark and Adobe Golden, then
    start `worker-character` with the `character-rig` Compose profile. Follow
     [`runbooks/character-rig-operations.md`](runbooks/character-rig-operations.md).
    `CHARACTER_INFERENCE_URL` may include a provider path prefix; both
    `https://provider.example/private-api` and the trailing-slash form resolve
    requests below `/private-api/`. Credentials, query strings, and fragments
    are rejected. Do not include `/v1` unless it is genuinely part of the
    provider's prefix, because the adapter appends its own versioned routes.
    The API advertises Character Studio only after both the flag is enabled and
    a fresh `worker-character` heartbeat is visible. Keep
    `CHARACTER_DRAIN_TIMEOUT_MS=30000` below the Compose stop grace period so an
    interrupted inference request is cancelled and its fenced job is requeued.
    For local end-to-end development, use `npm run dev:stack:character` after a
    compatible provider is listening at the configured URL.
15. Set `TRUSTED_PROXY_CIDR` to the narrow source CIDR used by the immediate TLS
    load balancer when it connects to Nginx. The load balancer must overwrite
    `X-Forwarded-Proto` and append the socket client address to
    `X-Forwarded-For`. Restrict port 8080 to that CIDR at the provider firewall;
    never use `0.0.0.0/0` or `::/0`.

Password-reset and email-verification tokens and their deliveries are inserted
atomically. Each API replica may run the outbox dispatcher: rows are claimed
with `FOR UPDATE SKIP LOCKED`, leased for a bounded period, and retried with
backoff. SMTP delivery is therefore at-least-once. The recipient and reset URL
are scrubbed immediately after success or terminal failure and old terminal
rows are removed by retention maintenance. Alert on sustained queued age or
repeated `email.delivery` retry/failure events; do not log action URLs or
tokens. Expired verification tokens are removed by retention maintenance, and
account deletion removes all remaining tokens before anonymization.

When Stripe is enabled, configure:

- `PAYMENT_MODE=live`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- Webhook URL: `https://<public-host>/v1/billing/webhooks/stripe`
- Enable Checkout, Customer Portal, and subscription lifecycle events for the
  configured products and prices.

## Release

`.node-version` is the authoritative Node.js runtime version. GitHub Actions
reads it through `node-version-file`, while `npm run verify:deployment` rejects
any mismatch in `package.json` or the digest-pinned Docker base images. The
reviewed production baseline is Node.js 24.18.1 (Krypton Active LTS) with its
bundled npm 11.16.0. Node.js 26 remains outside the production baseline until
that major reaches LTS and passes the complete release gate. Do not introduce a
second hard-coded CI version or install a different npm globally. Root
`devEngines` requires the exact Node and npm versions with `onFail=error` before
npm `install`, `ci`, and `run` commands, while `.npmrc` sets
`engine-strict=true` so dependency installation also fails on an incompatible
runtime. Do not bypass either contract with `--force`.

GitHub workflows use one reviewed `actions/setup-node` commit and one reviewed
`actions/checkout` commit, both running on the Node 24 Actions runtime. The
workflow security verifier rejects an older or divergent pin, and the toolchain
verifier requires every production Dockerfile to use the same immutable slim
Node image digest. The non-production QA image uses a separately pinned full
Bookworm image at the same exact Node version so Git/fontconfig are present
without a mutable package-manager download during the build.
Patch upgrades must update `.node-version`, the root manifest, Docker image
references, tests, and evidence together in one pull request.

Source QA runs in `Dockerfile.qa`, a non-production image that keeps the exact
Node/npm contract, Git for `verify:clean`, standard font support, and all test
dependencies. Build and run it with:

```bash
docker build --file Dockerfile.qa --tag motionprep-qa:local .
docker run --rm \
  --volume "$PWD/artifacts/qa:/workspace/artifacts/qa" \
  motionprep-qa:local
```

Its single command runs `npm run quality` and writes
`artifacts/qa/quality-summary.json`, including the application/toolchain
identity, timestamps, duration, outcome, and CI SHA when supplied. The QA image
must never be promoted as a runtime artifact.

The repository also enables npm's strict install-script policy in `.npmrc`.
Only the exact reviewed `esbuild` postinstall and macOS-only `fsevents` native
builds are permitted; non-functional `protobufjs` and `tesseract.js` install
scripts are denied. Dependency upgrades that add or change lifecycle scripts
must update the reviewed `allowScripts` policy before `npm ci` can succeed.

The `dependency-audit` workflow audits the complete runtime, build, and test
dependency tree daily so a newly published high or critical advisory can
invalidate an otherwise green release between pushes. A failed scheduled audit
blocks promotion until the lockfile is updated and the protected release gates
pass again.

Protect the `production-release` GitHub environment with required reviewers and
restrict deployments to protected tags/branches. Before publication, the
`release-images` workflow checks out the exact release SHA and re-runs
`npm run quality`, the complete dependency audit, and
`npm run test:topology:full`. The publish job cannot start unless this source
gate succeeds.

The workflow then builds each image once, publishes it to GHCR,
generates SBOM/provenance, scans it, signs the resulting digest with Cosign,
and uploads `release.env` plus `release-evidence.json`. Copy its
digest-qualified `RUNTIME_IMAGE_REF` and `WEB_IMAGE_REF` values and exact
`RELEASE_GIT_SHA` into the deployment environment. Production Compose
rejects missing references and does not contain build directives or tag
fallbacks.

The application/package version, immutable source SHA, tag, and image digest
serve different purposes and must not be substituted for one another. Follow
[`VERSIONING.md`](VERSIONING.md); staging verification requires an explicit
`EXPECTED_APPLICATION_VERSION` and never falls back to an old release number.

```bash
node scripts/verify-release-environment.mjs .env.production
node scripts/run-production-compose.mjs .env.production pull
node scripts/run-production-compose.mjs .env.production up -d
node scripts/run-production-compose.mjs .env.production ps
```

The wrapper revalidates the complete production environment before every
approved Compose operation. This is the mandatory path: Compose's non-empty
variable syntax alone accepts mutable tags, while the wrapper rejects anything
other than digest-qualified runtime/web references and an exact release SHA.

Character Studio is a separately gated profile:

```bash
node scripts/run-production-compose.mjs .env.production \
  --profile character-rig up -d worker-character
```

The `migrate` service applies all additive SQL migrations through migration 043
before the API and workers start. Migrations 038–041 add the Character Rig
domain, worker observability, review decisions, and the derived-asset registry;
migration 042 adds privacy/retention state machines and object-write leases,
and migration 043 adds single-use email verification;
earlier migrations 027 and 028 add the durable
email outbox and job correlation. Upload publication is then
committed atomically across the upload session, source version, and project;
the API startup reconciler re-inspects S3 metadata before repairing an
interrupted legacy state. The web container exposes port 8080 and proxies `/v1` to the private API
service. Only the web port should be published.

The migration runner waits at most `MIGRATION_ADVISORY_LOCK_TIMEOUT_MS` for the
single-runner advisory lock and applies `MIGRATION_LOCK_TIMEOUT_MS` to DDL lock
waits. `MIGRATION_STATEMENT_TIMEOUT_MS` defaults to a conservative 60 minutes,
so both locks and statements are fail-bounded without imposing a short web-style
deadline on legitimate DDL. Set it to `0` only as an explicit, reviewed exception
for a measured migration with its own operator deadline. A timeout fails the
release before API startup instead of leaving deployment indefinitely blocked.

Verify:

```bash
curl --fail https://<public-host>/healthz
curl --fail https://<public-host>/v1/health/live
curl --fail https://<public-host>/v1/health/ready
npm run verify:object-storage
```

After deployment, run the protected `staging-application-readiness` workflow.
It proves public web/API health, application version, exact release SHA, the
capability contract, and one authenticated PDF upload/process/export/download
journey. Run `performance-readiness` separately with representative concurrency.
Store a short-lived HTTPS URL for an approved near-limit corpus item in the
`REPRESENTATIVE_PDF_URL` environment secret, its lowercase SHA-256 in
`REPRESENTATIVE_PDF_SHA256`, and an explicit minimum size in
`REPRESENTATIVE_PDF_MIN_BYTES`. The workflow downloads the source without
logging the URL, rejects redirects outside HTTPS, verifies the digest, PDF
signature, and the configured upload ceiling, then deletes it with the runner.
The small repository smoke fixtures are not performance evidence. The protected
policy requires at least four concurrent users and twelve complete journeys.
Configure explicit p95, API RSS growth, aggregate worker RSS growth, and queue
age ceilings; the final queue depth must return to zero. The private metrics
endpoint is sampled throughout the run so the retained report includes
p50/p95/p99, API and worker RSS/heap/CPU peaks, queue peaks, final drain state,
and every acceptance decision. Both staging smoke and representative-load
reports bind the expected release SHA, application version, digest-qualified
image coordinates, and GitHub workflow provenance. Readiness is checked before
and after the load so a deployment change during measurement fails the gate.
Neither workflow turns a local smoke test into a provider or capacity
attestation.

The protected pre-release dependency probe is equivalent to running the
following two commands from a staging task with the deployment workload
identity and environment:

```bash
npm run verify:staging-dependencies --workspace @motionprep/api
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

The production Compose stack runs `maintenance-scheduler` hourly by default.
Each run takes a PostgreSQL advisory lock, so multiple deployed schedulers do
not overlap. Set `RETENTION_RUN_INTERVAL_MINUTES` between 15 and 1440 minutes.

For platforms with a native scheduler, disable the Compose scheduler and run
the same idempotent one-shot command at least hourly:

```bash
node scripts/run-production-compose.mjs .env.production \
  --profile maintenance run --rm maintenance
```

Each database prune is transactional and bounded by `RETENTION_BATCH_SIZE`.
It deletes expired upload and export bytes before marking their database rows
as purged. A storage failure leaves the row eligible for retry and makes the
command exit non-zero. It also removes expired sessions, MFA challenges,
password-reset tokens, idempotency keys, stale worker heartbeats, and old
terminal-job metadata according to the explicit retention variables. Audit and
usage-ledger defaults are 400 days; legal/compliance ownership must approve any
shorter value. Never apply this task to live `sources/` or `derived/` objects
that remain referenced by a project, upload, job, layer document, or source
restore history.

## Security controls

- The API image runs as a non-root user and all application containers use a
  read-only filesystem with bounded temporary directories. The web service
  gives `/etc/nginx/conf.d` a 1 MiB tmpfs solely for rendering its validated
  proxy template at startup; the image filesystem remains read-only.
- Cookies are Secure and HttpOnly in production.
- The public proxy and API enforce the shared 30 MiB request limit and emit
  HSTS and the remaining security headers on HTML, assets, health, and proxied
  API paths.
  Mirror HSTS at the TLS load balancer so edge-generated error responses carry
  it as well. The CSP deliberately retains `style-src 'unsafe-inline'` for the
  current React dynamic-style surface; do not describe it as a strict CSP.
- PostgreSQL, Redis, S3, SMTP, and authentication secrets are injected at
  runtime and are not baked into images.
- Browser object transfers pass through the authenticated API. The bucket has
  no public access, and v1 emits no presigned object URLs.
- Source, derived-raster, and artifact reads fail closed when their bytes, size,
  or content type do not match the metadata stored in PostgreSQL.
- Authenticated API and internal responses default to `Cache-Control: no-store`.
  A derived raster receives a one-year immutable policy only when its URL
  contains the server-verified SHA-256; legacy mutable URLs remain private and
  non-cacheable.
- Production API replicas share rate-limit state in Redis. A Redis outage makes
  dependency readiness fail and must not silently fall back to per-process
  limits.
- Artifact responses stream from object storage with backpressure and cancel
  the upstream read when the client disconnects. Metadata is checked before
  headers and SHA-256 is checked across the streamed bytes.
- Keep `TRUST_PROXY_HOPS=1` for the documented LB -> Nginx -> API topology.
  Nginx accepts forwarded metadata only from `TRUSTED_PROXY_CIDR`, resolves the
  nearest untrusted client address, and collapses the upstream chain to the one
  sanitized hop that Fastify trusts. If the topology changes, update the Nginx
  trust boundary and this hop count together and rerun the spoofing tests.
- Restrict database, Redis, and storage access to the application network or
  provider firewall.

## Scaling

Scale image and document workers independently. Export downloads do not buffer
the complete artifact in API memory. PDF decoders and raster transforms still
need complete source/asset buffers; these reads are bounded to the exact
persisted size, but worker concurrency multiplies that memory cost. Do not
increase document concurrency until memory use has been measured with
representative PDFs up to the 30 MiB product ceiling.
The database job claim uses row locking, so several worker replicas can safely
share the queue. Every processing/export job uses a renewable lease and bounded
retry; set `PROCESSING_LEASE_MS` and `EXPORT_LEASE_MS` above the normal p99 job
duration while retaining heartbeat headroom.

`EXPORT_JOB_TIMEOUT_MS` defaults to 10 minutes and is a hard isolation limit,
not a normal cancellation path. Export adapters use native, buffer-oriented
work that cannot be safely interrupted inside one Node process. If that limit
is reached, the export worker exits before settling the job; the supervisor
restarts it, operating-system memory is reclaimed, and the renewable lease
eventually makes the job eligible for its bounded retry. Alert on
`export.job_deadline_exceeded` and investigate the source before raising this
limit.

On `SIGTERM`, workers stop claiming new work and drain for
`PROCESSING_DRAIN_TIMEOUT_MS` or `EXPORT_DRAIN_TIMEOUT_MS` (30 seconds by
default). Any lease still active at the deadline is atomically returned to the
queue without consuming a retry attempt. Keep the container stop grace period
larger than the drain timeout; the production Compose profile uses 45 seconds.

Scrape `http://api:4000/internal/metrics` only from the private application
network. It exposes HTTP and job-duration histograms, queue depth/age, recent
retry, terminal-failure, and lease-loss counts, worker heartbeat gauges,
aggregate readiness, and provider-specific readiness for PostgreSQL, Redis,
object storage, and SMTP. It also exposes durable email-outbox state, immutable
release identity, the latest retention success/failure timestamps, and
`motionprep_maintenance_stale`; the administrator system view reports the same
durable state. Start from `deploy/prometheus-scrape.example.yml`, load
`deploy/grafana/dashboards/motionprep-overview.json`, and load
`deploy/prometheus-alerts.yml` into the monitoring system. Keep the bearer token
in the referenced secret file rather than the configuration. The CPU/RAM alerts
in that file consume the standard container runtime/cAdvisor
series and compare usage with the Compose ceilings. The public Nginx
configuration deliberately exposes no `/internal` location.
Route object-storage, SMTP/outbox, authentication anomaly, retry-storm, and
terminal-failure alerts through Alertmanager and use
`docs/runbooks/production-dependency-recovery.md` for provider recovery.

Distributed tracing is opt-in. Set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the
collector's full OTLP/HTTP traces endpoint (normally ending in `/v1/traces`).
Production rejects non-HTTPS endpoints and credentials embedded in the URL.
Pass collector authentication through `OTEL_EXPORTER_OTLP_HEADERS`, keep that
value in the deployment secret store, and begin with the parent-based ratio
sampler from `.env.production.example`.

The API creates server spans and persists valid W3C `traceparent`/`tracestate`
with processing and export jobs. Workers restore that parent before executing
the job, so a request can be followed across the PostgreSQL-backed queues.
`correlation_id` remains in responses and structured logs for support workflows;
tracing complements it rather than replacing it.

## External release gates and deliberately deferred scope

Before replacing an API instance, confirm the runtime secret file contains
`API_DEREGISTRATION_DELAY_MS=10000` and `API_SHUTDOWN_TIMEOUT_MS=130000`.
Readiness must change to `503 APPLICATION_DRAINING` before the listener closes;
the reverse proxy request deadline is 120 seconds and Compose grants the API
140 seconds before forced termination. A deployment that shortens this chain
can truncate uploads or other accepted requests and is not eligible to proceed.

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
