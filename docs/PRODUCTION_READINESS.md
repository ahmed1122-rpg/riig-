# Production readiness

Latest working-candidate verification on 2026-08-14 supersedes the local
counts below. The ordered remediation separates document-command feedback from
source upload state, adds storage-key-safe Raster diagnostics with layer
navigation, blocks incompatible cross-page/cross-folder reorder, and adds
bounded direct PDF text correction through the existing revisioned autosave
path. The exact tree passed 116 API files/492 tests, 73 web files/251 tests,
108 package tests across contracts/layer-domain/guidance/document/export,
every workspace typecheck and production build, coverage thresholds, lint,
CSS/architecture/contracts/dead-code/maintainability gates, and the isolated
Chromium E2E matrix 12/12. The measured bundle is 181.3 KiB gzip JavaScript
under a narrowly revised 182 KiB ratchet and 45.3 KiB CSS under 50 KiB; landing
startup remains eight requests, a 207.0 KiB hero, and zero blocking font
requests. `npm audit --omit=dev` reports zero vulnerabilities. Interactive QA
also completed account creation, a real PDF upload, two page folders, direct
text correction, and the 375 px mobile layer sheet. Production approval is
still withheld until managed PostgreSQL/S3 integration, immutable staging,
recovery/rollback, and representative load evidence exist for the same Git
SHA. See `artifacts/ordered-remediation-execution-2026-08-14.md`.

Earlier same-day candidate checkpoint on 2026-08-14: the report-guided hardening pass adds
bounded disk-staged upload streaming, end-to-end command cancellation,
central numeric layer validation, atomic project-review settlement awareness,
true virtualization for flat desktop/mobile layer lists, and scoped mobile
bulk state actions. During browser verification the new virtual list exposed a
menu stacking defect; the row positioning was corrected and the complete
isolated Chromium matrix then passed 12/12 on desktop and mobile. The exact
working tree also passed 116 API files/492 tests, 66 web files/232 tests, every
package/worker test, typecheck, ESLint, Stylelint, dead-code analysis,
architecture/contracts/maintainability verification, and every production
build. At that checkpoint the web bundle was 179.4 KiB gzip JavaScript,
45.1 KiB gzip CSS, and 63.19 KiB for the largest lazy chunk; a production
preview smoke also loaded the PDF workspace without a JavaScript error. These
are local source-candidate results only. No managed PostgreSQL/S3
run, provider IAM/versioning proof, staging deployment, recovery drill, or
representative load result has been produced for this exact working tree, so
production approval remains withheld. See
`artifacts/report-guided-remediation-2026-08-14.md`.

Working-candidate status on 2026-08-13: the sequenced local remediation and
Character Rig hardening are complete on the `0.1.8` package line. The
Turntable/Character Studio surface is deliberately image-only: capabilities
advertise only `image`, the web tool is absent from book/PDF workspaces, and all
nine Character API operations fail closed for a book project. The working tree
is not any hosted `v0.1.8` release: only its eventual Git SHA and signed image
digests can identify the new candidate. Local tests prove source correctness,
not managed-provider, deployed-staging, recovery, or representative-load
readiness. Keep `CHARACTER_RIG_ENABLED=false` until the ordered external gates
in [`EXTERNAL_GATE_INPUTS.md`](EXTERNAL_GATE_INPUTS.md) have passed.

Status through 2026-08-10: releases `v0.1.1`, `v0.1.2`, `v0.1.3`, `v0.1.5`,
`v0.1.6`, and `v0.1.7` were published
as signed digest-qualified runtime and web images after their protected
exact-SHA release workflows passed. Release `v0.1.3` contains the corrected
production-remediation baseline at
`452cd9941bd085fcad88c08bec7284f94d6f9db9`; its immutable coordinates and
hosted evidence are recorded below. A protected application-only rollback drill
from `v0.1.3` to `v0.1.2` also passed. Regional OCR remains disabled because its
independent holdout evidence is stale and the historical generation failed its
holdout target. Application deployment approval remains withheld until the
protected provider and staging workflows pass against real managed services.
Managed recovery and representative load/memory exercises remain explicit
launch gates. The licensed Adobe-version gate completed on 2026-08-10.

Security remediation on 2026-08-10 upgrades the PDF parser to
`pdfjs-dist` 6.2.108, the first patched release for
`GHSA-hq66-cqwq-w95j`/`CVE-2026-16633`, refreshes the vulnerable transitive
build dependency `nanoid` to 3.3.18, and moves every development, CI, and
container runtime to the single `.node-version` value `24.18.1`. A daily audit
of the complete runtime/build/test dependency tree now detects advisories that
appear after a green push build. The signed `v0.1.3` images predate this
remediation and are retained only as historical release evidence; they must not
be deployed. The signed `v0.1.7` images contain the remediation, the corrected
Adobe release evidence, and fail-closed Node/npm toolchain enforcement described
below.

The remediation was merged to `main` at
`104ce83234a0150d28e4e5a5b8996fab65d8b53a`. The `v0.1.4` tag points to that
commit, but its release workflow was cancelled before image publication after
licensed Adobe validation exposed two additional exporter defects: host-font
dependent PDF text pixels and PSD records written in the opposite order from
Adobe's Layers panels. The follow-up merged at
`6c7a2de557cf59f69049a27745031e16076e6a01`; it bundles the complete Noto Sans
Arabic TTF from `@expo-google-fonts/noto-sans-arabic@0.4.3`, installs
fontconfig in the pinned runtime, reproduces the reviewed PSD bytes during
every runtime build, and writes bottom-to-top PSD records. No `v0.1.4`
runtime or web image is eligible for deployment.

The licensed Adobe gate passed on 2026-08-10 with Photoshop 2026 (27.8.0) and
After Effects 2026 (26.3x87). Both PSDs opened as RGB/8 at the expected
dimensions and layer order, After Effects accepted
`Composition - Retain Layer Sizes`, and full-resolution preview comparison was
exact for `image-layers.psd`; `book-pages.psd` had mean absolute channel delta
0.015290 and maximum delta 1/255. Its RTL Golden layer deliberately combines
Arabic, ASCII digits, and Latin text to prove the complete bundled TTF avoids
host-font fallback. Machine-readable evidence and SHA-256 values
are stored in `artifacts/adobe-golden/`.

The first read-only GitHub audit on 2026-08-10 observed
`9cd4737b30b9e8cd974ea7b93578efc6da4b0e9d`; PR #31 subsequently advanced
`main` to `104ce83234a0150d28e4e5a5b8996fab65d8b53a`, and all required hosted CI
and CodeQL jobs passed on that exact SHA. The `production-readiness` and
`production-release` environments retain required-reviewer and branch
policies. The `v0.1.5` workflow published signed post-remediation images from
`6c7a2de557cf59f69049a27745031e16076e6a01`, but its generated evidence
incorrectly retained `licensedAdobeGolden: pending` after that gate had passed.
Those immutable images remain valid build evidence, but `v0.1.5` is not the
final deployment evidence bundle. Release `v0.1.6` at
`f0de756573741f3d9ecd610645347818bb118fde` superseded it and recorded
`licensed-adobe-golden` as completed only after `verify:adobe-golden` checks
both application result files. Release `v0.1.7` at
`86ad51f81098db1d36c714dd4c5ab63cf2da9613` supersedes `v0.1.6` as the current
candidate after making `.node-version` authoritative for every npm invocation,
including CLI steps in separate CI and release jobs. No post-remediation
managed-staging deployment exists. Public metadata cannot prove protected
secret contents or provider ownership, so the authenticated environment audit
and the external evidence gates below remain controlling.

The 2026-08-03 corrected-remediation pass adds revision-bound project review
approvals, request-fingerprint idempotency conflicts, atomic upload-integrity
failure and cancellation convergence, immutable export-generation identity,
public/admin job DTO boundaries, bounded job lists and aggregate admin status
queries. Migrations 031-036 implement the durable state. The local browser
runner always starts fresh servers on isolated API/Web ports (`45100`/`45101`
by default) so a stale process cannot silently substitute different bytes.
`PLAYWRIGHT_API_PORT` and `PLAYWRIGHT_WEB_PORT` may select other distinct,
non-privileged ports; existing servers are never reused.

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
- OpenAPI now documents all 79 registered v1 operations with summaries, tags,
  security, standard error envelopes, path parameters, and the principal write
  bodies. All nine Character Rig operations have explicit bodies and success
  schemas. Internal metrics remain excluded.
- The web application has a top-level recovery boundary and explicit revision
  conflict recovery. Large processing and workspace concerns were separated
  into inline-runner, PDF text-operation, raster-renderer, error, layer-bound,
  and autosave modules without increasing the public bundle beyond its budget.
- Bounded same-origin browser telemetry records sanitized React/runtime errors
  and LCP histograms without cookies or document content. Production builds
  generate hidden source maps, move them to restricted release evidence, and
  fail the bundle gate if any `.map` remains in the public web artifact.
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

The holdout implementation boundary now includes the production `pdf-ocr`
engine, review policy, and the shared preprocessing/segmentation pipeline. The
selector evaluator imports that same pipeline. Its full-grid mode evaluates
every declared candidate on development data first and emits validation as a
separate report; it rejects holdout as a selectable split. A change to any
protected production path invalidates the digest and requires a new sealed
holdout generation.

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

- The current Windows host reports Node `24.18.1` and npm `11.16.0`; the former
  Node 26 installation has been removed. Root `devEngines`, `.node-version`,
  `.npmrc`, every workspace version, and digest-pinned Docker stages agree on
  the enforced Node/npm policy.
- The final `motionprep-qa` image ran the complete `npm run quality` chain on
  2026-08-12 and passed in 226,630 ms. Its retained
  `artifacts/qa/quality-summary.json` records application `0.1.7`, Node
  `v24.18.1`, exit code 0, and outcome `passed`. The clean QA install contained
  554 packages with zero npm audit findings.
- Contract and maintainability gates report 71 HTTP operations, 39 immutable
  migrations, 397 production source files, zero oversized files, and zero exact
  clone blocks. ESLint, Stylelint, Knip, all workspace typechecks, all coverage
  thresholds, all 12 workspace builds, and the Adobe/Character benchmark gates
  passed in the same QA execution.
- Character lease, idempotency, result-fencing, and PostgreSQL convergence were
  repeated three times against a fresh PostgreSQL 17 database after migrations
  001-039. Every repetition passed 13 unit race cases and 4 real PostgreSQL
  integration cases. A deployment-contract test prevents the integration file
  from being silently excluded by Vitest again.
- That historical candidate measured 178.1 KiB JavaScript and 44.7 KiB CSS,
  gzip, within the then-enforced 180 KiB / 50 KiB total budgets. Its public landing
  route uses eight initial asset requests, a 207.0 KiB LCP image, and no
  blocking web-font request; every JavaScript chunk remains below 64 KiB gzip.
- Historical: `npm run quality` passed on 2026-08-04 after the account-privacy remediation.
- The 2026-08-10 dependency/toolchain remediation passed every configured
  quality component on Node 24.18.1/npm 11.16.0. The clean-worktree contract
  ran separately on the Windows host because the production-slim test image
  intentionally has no Git; the protected release job re-runs the single
  `npm run quality` command on Node 24 from `.node-version`.
- Historical 2026-08-10 evidence used the same exact Node/npm policy and passed
  the then-current API/web suites and configured coverage thresholds.
- Playwright E2E: 12/12 passed again locally on 2026-08-10 across desktop and
  mobile Chromium, including Axe checks, a real PDF upload/process journey,
  account-data export, resumable deletion, and the complete review/export
  journey. The protected release gate repeats this on Node 24.
- `npm audit --audit-level=high`: 0 known vulnerabilities across runtime, build, and test dependencies
  on the 2026-08-10 post-remediation lockfile. The same command now runs daily,
  in addition to push, pull-request, and protected release gates.
- Fixture verification after opening: 91 OCR samples, 20 books, 136 dimensions. The holdout-content digest still matches; the implementation digest is intentionally stale after later dependency and application changes, so the release gate remains disabled.
- Executable TODO/FIXME/HACK/NotImplemented scan: zero findings.
- `node scripts/verify-concurrent-migrations.mjs`: candidate 0.1.3 passed with two concurrent runners and idempotent replay after migrations 001-037. This is local candidate evidence and is not retroactively attributed to a hosted release.
- Durable PostgreSQL/S3 suite: 20/20, including project-review approval/invalidation, upload integrity and cancellation convergence, source restoration, lease reclamation, active-job exclusivity, ordered billing events, reference-safe retention, object round trips, a real export worker, and account deletion across PostgreSQL and versioned object storage.
- `npm run test:topology:full`: passed again on 2026-08-10 from the final strict-install image with migration 037, two API replicas, PostgreSQL, shared Redis rate limits, versioned MinIO, Mailpit/outbox delivery, all three workers, restart recovery, revision-approved export, trace identity, metrics, and a signed Stripe webhook. The run injected and recovered Redis, MinIO, Mailpit, and PostgreSQL outages, then completed 2/2 concurrent PDF smoke journeys with a 0% error rate, 1,347 ms workflow p95, zero final queue depth, a 28,672-byte API RSS peak delta, and a 7,352,320-byte worker RSS peak delta. The 1,278-byte fixture is workflow evidence, not representative capacity evidence.
- On 2026-08-13 the production-shaped runner also completed 20/20 concurrent
  end-to-end journeys with a valid 31,416,448-byte (29.961 MiB) PDF. Workflow
  p95 was 28,124 ms; API and worker RSS peak growth were 384,753,664 and
  224,464,896 bytes respectively; queue depth peaked at 13 with 5.11 seconds
  oldest age and drained to zero. The machine-readable local candidate evidence
  is retained in `artifacts/benchmarks/pdf-capacity/2026-08-13-20x29.96mib.json`.
  This does not replace the release-bound managed-staging performance gate.
- Docker runtime and web images build from digest-pinned bases with a strict
  install-script allowlist. Both passed current High/Critical Trivy 0.72.0
  scans. The web image passed a read-only, non-root, `cap-drop ALL`,
  `no-new-privileges` health smoke; the runtime ran as UID 1000 with npm absent.
- The Windows topology runner now creates and cleans a temporary ASCII junction when the workspace path contains Unicode; the official command passed from this Arabic workspace path.
- Historical only: a local OCI release was published from source commit `0a2103addf1c71ed6402d955a9a59d8da0d17485`, and tag `v0.1.0` was published from `48bdfd9b53b0c955a93f5a121660ea9b3e546df4`. Their retained verification records remain useful evidence for the signing mechanism, but their digests do **not** contain this candidate and must not be deployed as its release.

## Hosted release evidence — v0.1.7

- PR #37 was squash-merged to `main` at
  `86ad51f81098db1d36c714dd4c5ab63cf2da9613`; all exact-SHA CI, CodeQL,
  secret-scan, E2E, durable integration, release fixture, topology, container,
  and Trivy gates passed.
- Protected release run `31428698318` rechecked the exact tag source and
  published SBOM/provenance-bearing images after repository-bound Cosign
  signing and verification.
- Runtime: `ghcr.io/ahmed1122-rpg/motionprep-runtime@sha256:a7883a1b3180e8da9c4b461aaf23adac0fac4bc49b84bd2ceae89724bef7ff56`.
- Web: `ghcr.io/ahmed1122-rpg/motionprep-web@sha256:31c43f772d43a34f10600d50958538340edbd45c81b96aeca2af8a413c813cfd`.
- Its immutable evidence names `licensed-adobe-golden` as completed, omits the
  stale external Adobe status, and records passing topology and dependency
  fault recovery.
- Protected rollback run `31429820987` verified candidate and rollback image
  signatures, ran the `v0.1.7` PDF journey, performed application-only rollback
  to `v0.1.2` while retaining additive migrations, and passed the rollback PDF
  journey. Both error rates were 0%; workflow times were 1,148 ms and 1,358 ms.
  The environment now binds `ROLLBACK_DRILL_STATUS=passed` to the exact v0.1.7
  source SHA and run URL.

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

The 2026-08-13 phase-five local gates prove bounded 30 MiB upload ingestion,
progressive password-hash upgrading, MFA keyring rotation compatibility,
single-use email verification, one-shot administrator bootstrap under a
  20-request race, secret redaction, CSP/client-report sanitization, private web
  source-map extraction, workload env-file
separation, migration-role separation, and private-source license/security
policy checks. These are repository and in-memory proofs; they are not a claim
that PostgreSQL races, provider IAM, SMTP delivery, or recovery work in managed
staging.

1. Live staging evidence for TLS-protected PostgreSQL, Redis, SMTP, and provider-owned S3, including versioning, encryption, retention, integrity, and least privilege.
2. A clean `v0.1.8` commit/tag, hosted CI, signed digest-qualified images, and
   deployment of those same digests to managed staging without rebuilding.
   The historical `v0.1.7` rollback evidence proves the mechanism only; it
   cannot approve the changed 0.1.8 source.
3. A signed isolated backup/restore recovery drill against production-shaped
   managed storage proving RPO ≤15 minutes and RTO ≤4 hours. The completed
   application rollback drill does not prove backup restoration.
4. Representative load and memory validation against the configured container ceilings. The automated PDF workflow and evidence format exist, but local smoke evidence is not a representative managed-staging capacity result. Tune `RASTER_ASSET_WRITE_CONCURRENCY` between 1 and 4 from the structured `processing.raster_asset_write_observed` event, which records asset count, bytes, duration, concurrency, and outcome in both inline and worker paths.

The OCR scope gate is resolved for the current candidate by keeping
`PDF_REGION_OCR_ENABLED=false`. Re-enabling it requires a newly sealed holdout
that meets CER <= 25% or a separately approved claim and review policy.

The external-state audit repeated on 2026-08-10 found no secrets in the protected
`production-readiness` environment and no provider/staging variables beyond
release, rollback, application-version, and OCR coordinates. The release
coordinates now reference `v0.1.7`, and its protected rollback drill is current.
The provider, staging,
staging-application, and representative-performance workflows were not started:
they would be guaranteed preflight failures rather than provider evidence.
Required configuration includes managed `DATABASE_URL` and `REDIS_URL`, SMTP
coordinates and credentials, S3 endpoint/region/bucket/encryption plus either
OIDC role or explicit temporary credentials, recovery manifest/signing public
key, staging origin/host/metrics URL, metrics bearer token, representative PDF
URL/digest/size, and explicit p95/memory/queue thresholds. No paid or
account-owned staging resource is inferred or created from local evidence.

The production Compose control file points to seven distinct secret files:
migration, API, maintenance, media worker, document worker, export worker, and
character worker. Migration uses `MIGRATION_DATABASE_URL`; every other runtime
must have a distinct database username and workload identity. Reusing a secret
file or runtime database identity is a deployment-gate failure. The remaining
provider evidence must additionally prove that the corresponding S3/IAM
identity is least privilege, not merely that different credential strings were
configured.

The phase-six local platform changes expose `/readyz` separately from Nginx
liveness, publish per-worker `ready/degraded/not_required` states in capability
schema 1.1, and bind each Docker worker healthcheck to its own heartbeat ID and
the exact release SHA. Readiness workflows now checkout `RELEASE_GIT_SHA`,
require its matching semantic-version tag, and run repository-bound Cosign
verification before provider or load probes. `MotionPrepApiDown` and
`MotionPrepApiMetricsAbsent` cover scrape-target and absent-metric failures.
The JavaScript/unit deployment checks pass locally; promtool evaluation awaits
an available Docker daemon or hosted CI and is not recorded as PASS here.

Migration operations also require an explicit bounded-wait policy. The shipped
defaults are `MIGRATION_ADVISORY_LOCK_TIMEOUT_MS=30000`,
`MIGRATION_LOCK_TIMEOUT_MS=15000`, and
`MIGRATION_STATEMENT_TIMEOUT_MS=3600000`. The runner polls the advisory lock to
a real deadline, bounds DDL lock waits, and allows up to 60 minutes for a
legitimate long statement. Setting the statement timeout to `0` disables that
last safety boundary; it is an exceptional operator decision that requires a
measured migration plan, an external deadline, monitoring, and rollback review.

API shutdown follows an ordered drain contract. On `SIGTERM`/`SIGINT`, the
instance first makes `/v1/health/ready` return `503 APPLICATION_DRAINING`, waits
`API_DEREGISTRATION_DELAY_MS=10000` for the load balancer to remove it, and then
closes Fastify while accepted requests finish. `API_SHUTDOWN_TIMEOUT_MS=130000`
covers deregistration plus Nginx's 120-second request deadline; the API service
uses a 140-second Compose grace period as the outer limit. Preserve the ordering
`proxy request deadline <= shutdown minus deregistration < stop grace` whenever
one value changes.

The corrected 0.1.3 implementation report is in `artifacts/corrected-remediation-final-report-2026-08-04.md`; the final hosted release and rollback record is in `artifacts/release-v0.1.3-production-evidence-2026-08-04.md`. Historical 0.1.2 evidence is in `artifacts/production-hardening-0.1.2-implementation-report-2026-08-01.md`; current controls and local evidence are documented in this file and the retained topology/fault reports. The earlier remediation report is in `artifacts/final-remediation-implementation-report-2026-08-01.md`. Historical release and OCR evidence remains in `artifacts/production-readiness-implementation-report-2026-07-30.md`, `artifacts/release/release-v0.1.0.md`, `artifacts/release/release-0a2103a.md`, and `artifacts/benchmarks/ocr-arabic-corpus/latest-report.json`.

The current completion matrix, remaining priorities, acceptance criteria, and PDF fixture inventory are in `artifacts/completion-audit-and-execution-plan-2026-07-31.md`.
