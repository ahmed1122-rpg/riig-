# Production readiness

Status on 2026-08-04: releases `v0.1.1`, `v0.1.2`, and `v0.1.3` were published
as signed digest-qualified runtime and web images after their protected
exact-SHA release workflows passed. Release `v0.1.3` contains the corrected
production-remediation baseline at
`452cd9941bd085fcad88c08bec7284f94d6f9db9`; its immutable coordinates and
hosted evidence are recorded below. A protected application-only rollback drill
from `v0.1.3` to `v0.1.2` also passed. Regional OCR remains disabled because its
independent holdout evidence is stale and the historical generation failed its
holdout target. Application deployment approval remains withheld until the
protected provider and staging workflows pass against real managed services.
Managed recovery, licensed Adobe-version validation, and representative
load/memory exercises remain explicit launch gates.

Candidate security remediation on 2026-08-10 upgrades the PDF parser to
`pdfjs-dist` 6.2.108, the first patched release for
`GHSA-hq66-cqwq-w95j`/`CVE-2026-16633`, refreshes the vulnerable transitive
build dependency `nanoid` to 3.3.18, and moves every development, CI, and
container runtime to the single `.node-version` value `24.18.1`. A daily audit
of the complete runtime/build/test dependency tree now detects advisories that
appear after a green push build. The signed `v0.1.3` images predate this
remediation and are retained only as historical release evidence; they must not
be deployed. Publication requires a new exact-SHA signed release after the
protected gates pass.

A read-only GitHub audit on 2026-08-10 confirmed that `main` still resolves to
`9cd4737b30b9e8cd974ea7b93578efc6da4b0e9d`, with successful hosted `quality`
and CodeQL runs for that SHA. The `production-readiness` and
`production-release` environments both retain required-reviewer and branch
policies. The newest published release and release deployment remain
`v0.1.3`; no post-remediation release or managed-staging deployment exists in
the public deployment record. Public metadata cannot prove protected secret
contents or provider ownership, so the 2026-08-04 authenticated environment
audit and the external evidence gates below remain controlling.

The 2026-08-03 corrected-remediation pass adds revision-bound project review
approvals, request-fingerprint idempotency conflicts, atomic upload-integrity
failure and cancellation convergence, immutable export-generation identity,
public/admin job DTO boundaries, bounded job lists and aggregate admin status
queries. Migrations 031-036 implement the durable state. The local browser
runner now starts fresh servers by default so a stale process cannot silently
substitute different API bytes; reuse requires the explicit
`PLAYWRIGHT_REUSE_SERVER=true` opt-in.

The 2026-08-04 account-privacy pass makes policy consent versioned and
auditable, exposes authenticated metadata export, and adds resumable account
deletion. Migration 037 records the accepted terms/privacy versions and durable
deletion requests. Deletion revokes sessions before object removal, blocks live
subscriptions, retries failed storage cleanup through maintenance, then removes
owned projects and anonymizes the retained account/billing identity. The Arabic
policy documents remain operational drafts and require owner/legal approval and
final controller/contact details before public launch.

The 2026-08-02 guidance-hardening pass adds provider-specific readiness,
durable email-outbox metrics, API/worker RSS/heap/CPU evidence, release identity
metrics, Prometheus rule simulations, audited export replay fenced to the exact
ready source and document revision, and retained managed-provider/fault/load
evidence artifacts. The protected performance gate now refuses smoke-sized
runs below four concurrent users and twelve complete workflows, requires
explicit p95/memory/queue ceilings, samples resource peaks during the run, and
requires the final queue to drain. The production-shaped local topology passed
Redis, S3, SMTP, and PostgreSQL outage/recovery probes plus two post-recovery PDF
journeys with zero failures and zero final queue depth. This remains local
evidence and does not replace the external launch gates above.

The production-readiness work adds server-authoritative upload verification, source/job fencing, ordered Stripe webhook application, bounded worker drain and lease requeue, scheduled retention with operational status, audited administrator retry, truthful billing/export controls, accessible layer reordering, and a release workflow that re-runs source quality and production topology against the exact checkout SHA before publication. These changes are represented by `v0.1.1`; the historical `v0.1.0` digests must not be used for this release.

The changes first published in `0.1.2` add release identity to readiness, durable request-to-job
correlation, stricter TypeScript checks, import-cycle enforcement, deterministic
dependency fault/recovery checks, concurrent PDF workflow load evidence,
staging application verification, release evidence JSON, and maintained
Prometheus/Grafana configuration. These controls are implemented in source;
their hosted results remain evidence gates rather than assumptions.

## Implemented locally

- Incident response now has a severity/ownership/containment runbook and a
  machine-verified evidence manifest. The verifier enforces chronological UTC
  state, acknowledgement targets, immutable release identity, known alert
  names, redaction, closed-incident actions, a stable monitoring window, owned
  follow-ups, and Ed25519 attestation. Recovery and incident evidence share one
  signing implementation, and the maintainability ratchet remains at zero exact
  clone blocks.
- The application error boundary now reports failures only when the browser
  supports `reportError`, keeps its fallback usable if reporting itself fails,
  and offers an in-place remount that rebuilds the UI from the durable session
  before requiring a full-page reload. Component tests cover unavailable and
  failing reporters plus transient-crash recovery.
- Protected staging and representative-load reports now bind the expected
  release SHA, application version, digest-qualified images, and GitHub
  workflow provenance. The PDF workflow checks the public release identity
  before and after load so a mid-run deployment fails the capacity gate.
- Upload publication now uses one PostgreSQL transaction for the upload,
  source-version, and project state. A bounded reconciler repairs legacy or
  interrupted `verifying`/`ready` state only after re-inspecting object size,
  type, and SHA-256.
- Password-reset creation and email enqueue are atomic. PostgreSQL provides a
  lease-based outbox with bounded exponential retry, terminal scrubbing of the
  recipient and reset URL, and scheduled retention.
- Production rate limits use the shared Redis store across API replicas.
  Sensitive API responses default to `Cache-Control: no-store`; derived raster
  assets become immutable only when addressed by their verified SHA-256 and
  support `ETag`/`304`.
- `/v1/capabilities` is the server-authoritative feature contract. Web tools
  fail closed when regional OCR is unavailable, and display the server reason
  instead of exposing a decorative or non-operational action.
- OpenAPI now documents all 55 registered v1 operations with summaries, tags,
  security, standard error envelopes, path parameters, and the principal write
  bodies. Internal metrics remain excluded.
- The web application has a top-level recovery boundary and explicit revision
  conflict recovery. Large processing and workspace concerns were separated
  into inline-runner, PDF text-operation, raster-renderer, error, layer-bound,
  and autosave modules without increasing the public bundle beyond its budget.
- Checkout returns are confirmed from a server-owned session rather than URL
  query text. Pending review edits are flushed before internal/back navigation,
  and an unload warning protects edits that still cannot be persisted.
- Cookie-authenticated unsafe requests enforce same-origin evidence, production
  fails closed when origin evidence is absent, and request IDs are generated by
  the server rather than trusted from clients.
- The deterministic PDF matrix covers embedded text, scanned Arabic, mixed page
  geometry/rotation/transparency, the 251-page policy limit, and a truncated
  invalid document.
- Source-version restoration with actor/reason history, optimistic preconditions, idempotency, and persistent revision references.
- Persistent layer-document revisions with server-side undo/redo and bounded retention.
- PDF text split and merge with RTL-aware geometry and reading-order repair.
- Regional PDF OCR rendered from the immutable original source, worker-backed in production, with coordinate translation and atomic compare-and-swap persistence.
- Raster edge refinement and raster-layer merge as immutable derived PNG assets with integrity metadata and failed-publication cleanup.
- `PDF_REGION_OCR_ENABLED` as an emergency kill switch, disabled by default until the independent CER gate passes. Existing HTTP and worker metrics cover request status/duration, queue age/depth, retries, lease loss, and worker duration without logging source text.

## OCR release gate — generation 6

Generation 6 was created from two never-before-used public-domain sources, sealed before the final OCR selector change, and opened once after the complete quality and browser gates passed. Subsequent dependency and application changes invalidated its implementation digest. The corpus-content seal is still checked, but generation 6 is historical evidence only and cannot authorize re-enabling regional OCR.

- Corpus: 91 pages, 20 public-domain books, 136 documented dimensions.
- Opened at: `2026-07-31T11:59:59.287Z`.
- Implementation SHA-256: `5255fe821215181b7bb75144fa1c9a194835a5519db9bd1d4e525a0c138db3a7`.
- Holdout-content SHA-256: `c53efecd26164b3e5f4b4df301e7180b626ae2f000780924e4d23da22aca71e0`.

| Split | Pages | CER | Decision |
|---|---:|---:|---|
| Development | 74 | 18.90% | diagnostic |
| Validation | 7 | 15.13% | stable |
| Holdout v6 | 10 | 27.02% | fail: target ≤25% |
| Full corpus | 91 | 19.39% | aggregate target passes |

The v5 low-contrast pages improved from 58.82%/52.97% to 17.94%/13.41% without validation regression. The v6 printed-book source passed at 16.26%; the manuscript source reached 43.81%, and `jurjani-008-manuscript` exceeded the 50% page limit at 53.76%. The historical development table remains at 69.02%. All five manuscript pages and the table produce final confidence below 0.35 and are marked `needs_review`.

Therefore the strict benchmark exits non-zero and regional OCR is No-Go. The current release scope keeps that endpoint disabled, while ordinary PDF ingestion, editing, and export remain eligible for staging. If OCR is re-enabled later, the approved product claim remains limited to printed Arabic documents with mandatory human review; reliable manuscript or degraded-table transcription is not supported by the evidence.

## Local evidence

- `npm run quality`: passed on 2026-08-04 after the account-privacy remediation.
- The 2026-08-10 dependency/toolchain remediation passed every configured
  quality component on Node 24.18.1/npm 11.16.0. The clean-worktree contract
  ran separately on the Windows host because the production-slim test image
  intentionally has no Git; the protected release job re-runs the single
  `npm run quality` command on Node 24 from `.node-version`.
- API tests: 305/305 across 73 files; web tests: 126/126 across 33 files; the remaining workspaces also passed. All configured coverage gates passed. Complete-source API coverage is 67.18% statements, 58.00% branches, 69.56% functions, and 68.53% lines; complete-source web coverage is 35.68%, 35.49%, 27.35%, and 36.71% respectively.
- Playwright E2E: 12/12 passed again locally on 2026-08-10 across desktop and
  mobile Chromium, including Axe checks, a real PDF upload/process journey,
  account-data export, resumable deletion, and the complete review/export
  journey. The protected release gate repeats this on Node 24.
- Web bundle: 157.5 KiB JavaScript and 42.2 KiB CSS, gzip.
- `npm audit --audit-level=high`: 0 known vulnerabilities across runtime, build, and test dependencies
  on the 2026-08-10 post-remediation lockfile. The same command now runs daily,
  in addition to push, pull-request, and protected release gates.
- Fixture verification after opening: 91 OCR samples, 20 books, 136 dimensions. The holdout-content digest still matches; the implementation digest is intentionally stale after later dependency and application changes, so the release gate remains disabled.
- Executable TODO/FIXME/HACK/NotImplemented scan: zero findings.
- `node scripts/verify-concurrent-migrations.mjs`: candidate 0.1.3 passed with two concurrent runners and idempotent replay after migrations 001-037. This is local candidate evidence and is not retroactively attributed to a hosted release.
- Durable PostgreSQL/S3 suite: 20/20, including project-review approval/invalidation, upload integrity and cancellation convergence, source restoration, lease reclamation, active-job exclusivity, ordered billing events, reference-safe retention, object round trips, a real export worker, and account deletion across PostgreSQL and versioned object storage.
- `npm run test:topology:full`: passed again on 2026-08-10 from the final strict-install image with migration 037, two API replicas, PostgreSQL, shared Redis rate limits, versioned MinIO, Mailpit/outbox delivery, all three workers, restart recovery, revision-approved export, trace identity, metrics, and a signed Stripe webhook. The run injected and recovered Redis, MinIO, Mailpit, and PostgreSQL outages, then completed 2/2 concurrent PDF smoke journeys with a 0% error rate, 1,347 ms workflow p95, zero final queue depth, a 28,672-byte API RSS peak delta, and a 7,352,320-byte worker RSS peak delta. The 1,278-byte fixture is workflow evidence, not representative capacity evidence.
- Docker runtime and web images build from digest-pinned bases with a strict
  install-script allowlist. Both passed current High/Critical Trivy 0.72.0
  scans. The web image passed a read-only, non-root, `cap-drop ALL`,
  `no-new-privileges` health smoke; the runtime ran as UID 1000 with npm absent.
- The Windows topology runner now creates and cleans a temporary ASCII junction when the workspace path contains Unicode; the official command passed from this Arabic workspace path.
- Historical only: a local OCI release was published from source commit `0a2103addf1c71ed6402d955a9a59d8da0d17485`, and tag `v0.1.0` was published from `48bdfd9b53b0c955a93f5a121660ea9b3e546df4`. Their retained verification records remain useful evidence for the signing mechanism, but their digests do **not** contain this candidate and must not be deployed as its release.

## Hosted release evidence — v0.1.3

This release is historical and is no longer deployment-eligible because its
locked `pdfjs-dist` 6.1.200 predates the security fix in 6.2.108. Its records
continue to prove the release and rollback mechanisms, not current dependency
security.

- PR #22 passed the complete protected check set and was squash-merged to
  `main` at `452cd9941bd085fcad88c08bec7284f94d6f9db9`.
- Protected release run `30904738809` rechecked the exact tag SHA, quality,
  production dependency audit, browser E2E, concurrent migrations, durable
  PostgreSQL/S3 integration, production topology, dependency fault recovery,
  and concurrent PDF smoke journeys before publication was approved.
- Runtime: `ghcr.io/ahmed1122-rpg/motionprep-runtime@sha256:b7afc62ded55d7b3c6808c92adf367a5c089175f12807cb8ee48555e53360d0e`.
- Web: `ghcr.io/ahmed1122-rpg/motionprep-web@sha256:00159a357e13abd8c021f877ec20c5b075668ec0da1df08cbf1358d384bd8804`.
- The published images passed hardened clean-runner smoke tests and
  High/Critical Trivy scans, contain SBOM/provenance attestations, and were
  keylessly signed and verified against the repository-bound GitHub OIDC
  identity.
- The first rollback run exposed a harness incompatibility: the current load
  client called a review-approval route that did not exist in `v0.1.2`. PR #24
  made the rollback journey use the target release's pre-approval flow while
  retaining approval-required review as the current default.
- Corrected protected rollback run `30907536496`, sourced from
  `0bb93a19ac166d0b5a8b35514a81591cab6b72ae`, verified both releases'
  signatures and images, candidate and rollback readiness/web health, a PDF
  journey on each release, and application-only rollback without reversing the
  additive schema. Both journeys had a 0% error rate; candidate workflow p95
  was 1,258 ms and rollback workflow p95 was 1,206 ms. These one-journey
  results prove the rollback path, not representative capacity.

## Hosted release evidence — v0.1.1

- PR #14 passed all nine required checks and was squash-merged to protected
  `main`. The merged SHA passed the complete `main` CI run, CodeQL, secret scan,
  Dependabot analyses, browser E2E, durable integration, release fixtures,
  production topology, container hardening, and Trivy.
- Protected release run `30714117234` rechecked clean exact-SHA source, quality,
  audit, browser journeys, concurrent migrations, durable PostgreSQL/S3, and
  the production-shaped topology before the publish job was approved.
- Both published OCI indexes contain linux/amd64 images plus attestation
  manifests. The workflow generated SBOM/provenance, found no unresolved
  High/Critical Trivy finding, signed both digests with keyless Cosign, and
  verified repository-bound GitHub OIDC identities before writing the manifest.
- Runtime: `ghcr.io/ahmed1122-rpg/motionprep-runtime@sha256:2243850e5315fd7827a09c6ff16859ca5e3ed2cc05d6a1366478a21e8523a85c`.
- Web: `ghcr.io/ahmed1122-rpg/motionprep-web@sha256:63185c525bd08d0073d384452966159aef49dc4cfb827d956b27196f224bc3b4`.
- The immutable manifest artifact records `RELEASE_GIT_SHA=3f29087cc22e604e9cca66455a3ef9d359a5d85c`, and both GHCR references resolve independently by digest.

## Evidence still required

1. Live staging evidence for TLS-protected PostgreSQL, Redis, SMTP, and provider-owned S3, including versioning, encryption, retention, integrity, and least privilege.
2. Publication of new post-remediation signed image digests, followed by their
   deployment to managed staging and a complete application smoke without
   rebuilding. The historical `v0.1.3` digests are explicitly ineligible. The
   local and signed-image rollback path has passed, but this does not substitute
   for the deployed staging smoke.
3. A signed isolated backup/restore recovery drill against production-shaped
   managed storage proving RPO ≤15 minutes and RTO ≤4 hours. The completed
   application rollback drill does not prove backup restoration.
4. Golden PSD/After Effects validation in licensed target Adobe versions (deferred by product decision).
5. Representative load and memory validation against the configured container ceilings. The automated PDF workflow and evidence format exist, but local smoke evidence is not a representative managed-staging capacity result. Tune `RASTER_ASSET_WRITE_CONCURRENCY` between 1 and 4 from the structured `processing.raster_asset_write_observed` event, which records asset count, bytes, duration, concurrency, and outcome in both inline and worker paths.

The OCR scope gate is resolved for the current candidate by keeping
`PDF_REGION_OCR_ENABLED=false`. Re-enabling it requires a newly sealed holdout
that meets CER <= 25% or a separately approved claim and review policy.

The external-state audit on 2026-08-04 found no secrets in the protected
`production-readiness` environment and no provider/staging variables beyond
release, rollback, and OCR coordinates. Therefore the provider, staging,
staging-application, and representative-performance workflows were not started:
they would be guaranteed preflight failures rather than provider evidence.
Required configuration includes managed `DATABASE_URL` and `REDIS_URL`, SMTP
coordinates and credentials, S3 endpoint/region/bucket/encryption plus either
OIDC role or explicit temporary credentials, recovery manifest/signing public
key, staging origin/host/metrics URL, metrics bearer token, representative PDF
URL/digest/size, and explicit p95/memory/queue thresholds. No paid or
account-owned staging resource is inferred or created from local evidence.

The corrected 0.1.3 implementation report is in `artifacts/corrected-remediation-final-report-2026-08-04.md`; the final hosted release and rollback record is in `artifacts/release-v0.1.3-production-evidence-2026-08-04.md`. Historical 0.1.2 evidence is in `artifacts/production-hardening-0.1.2-implementation-report-2026-08-01.md`; current controls and local evidence are documented in this file and the retained topology/fault reports. The earlier remediation report is in `artifacts/final-remediation-implementation-report-2026-08-01.md`. Historical release and OCR evidence remains in `artifacts/production-readiness-implementation-report-2026-07-30.md`, `artifacts/release/release-v0.1.0.md`, `artifacts/release/release-0a2103a.md`, and `artifacts/benchmarks/ocr-arabic-corpus/latest-report.json`.

The current completion matrix, remaining priorities, acceptance criteria, and PDF fixture inventory are in `artifacts/completion-audit-and-execution-plan-2026-07-31.md`.
