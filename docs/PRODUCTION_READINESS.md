# Production readiness

Status on 2026-07-31: the six planned editing tools are implemented; local and GitHub-hosted quality, security, durable-integration, production-topology, and browser gates pass. `main` is protected, the readiness/release environments are protected, and PRs #11 and #12 are merged at `b58ffcf1d214bb1d6a4df2034984fc86dfee34a6`. Regional OCR is now disabled by default because the independent holdout remains red. Production approval remains withheld because real provider staging has not been provisioned and the current `main` commit has not yet produced signed release images. Recovery, Adobe, and load/memory exercises are explicitly deferred.

The merged production-readiness work adds server-authoritative upload verification, source/job fencing, ordered Stripe webhook application, bounded worker drain and lease requeue, scheduled retention with operational status, audited administrator retry, truthful export controls, accessible layer reordering, and a release workflow that re-runs source quality and production topology before publication. These changes are not represented by the previously published `v0.1.0` digests until a new protected release completes.

## Implemented locally

- Source-version restoration with actor/reason history, optimistic preconditions, idempotency, and persistent revision references.
- Persistent layer-document revisions with server-side undo/redo and bounded retention.
- PDF text split and merge with RTL-aware geometry and reading-order repair.
- Regional PDF OCR rendered from the immutable original source, worker-backed in production, with coordinate translation and atomic compare-and-swap persistence.
- Raster edge refinement and raster-layer merge as immutable derived PNG assets with integrity metadata and failed-publication cleanup.
- `PDF_REGION_OCR_ENABLED` as an emergency kill switch, disabled by default until the independent CER gate passes. Existing HTTP and worker metrics cover request status/duration, queue age/depth, retries, lease loss, and worker duration without logging source text.

## OCR release gate — generation 6

Generation 6 was created from two never-before-used public-domain sources, sealed before the final OCR selector change, and opened once after the complete quality and browser gates passed. The protected implementation has not changed since opening.

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

- `npm run quality`: passed after the final protected OCR change.
- API tests: 153/153; document-processing tests: 38/38; web tests: 71/71; all configured coverage gates passed.
- Playwright E2E: 6/6 across desktop and mobile Chromium.
- Web bundle: 141.1 KiB JavaScript and 36.6 KiB CSS, gzip.
- `npm audit --omit=dev --audit-level=high`: 0 known production vulnerabilities.
- Fixture verification after opening: 91 OCR samples, 20 books, 136 dimensions; implementation and holdout digests match.
- Executable TODO/FIXME/HACK/NotImplemented scan: zero findings.
- `node scripts/verify-concurrent-migrations.mjs`: passed against PostgreSQL after migrations 021/022, including two simultaneous runners and an idempotent replay.
- Durable PostgreSQL/S3 suite: 12/12 after migrations 001-026, covering source restoration, lease reclamation, active-job exclusivity, ordered billing events, reference-safe retention, maintenance status, object round trips, and a real export worker.
- `npm run test:topology:full`: passed with two API replicas, PostgreSQL, Redis, versioned MinIO, Mailpit, all three workers, restart recovery, export, metrics, and a signed Stripe webhook.
- Docker runtime and web images build from digest-pinned bases. The web image passed a read-only, non-root, `cap-drop ALL`, `no-new-privileges` health smoke.
- The Windows topology runner now creates and cleans a temporary ASCII junction when the workspace path contains Unicode; the official command passed from this Arabic workspace path.
- A local OCI release was published from source commit `0a2103addf1c71ed6402d955a9a59d8da0d17485` with BuildKit SBOM/provenance, zero unresolved Trivy High/Critical findings, and verified Cosign signatures. The published runtime digest is `sha256:1daeff9e92a8c76553e1e29a97e561547cc7933d504fde15c347be859586c757`; the web digest is `sha256:6aa68db109366280864392ade512a0b70ea4fe0069100ed20e4114283c60a619`.
- The local signing private key was deleted after verification; only the public verification key and non-secret verification records are retained under `artifacts/release/`.
- GitHub-hosted quality and CodeQL passed on release SHA `48bdfd9b53b0c955a93f5a121660ea9b3e546df4`. Tag `v0.1.0` published public GHCR runtime/web digests with SBOM/provenance, zero Trivy High/Critical findings, and repository-bound Cosign keyless signatures independently verified against GitHub OIDC and the Sigstore transparency log.

## Evidence still required

1. Live staging evidence for TLS-protected PostgreSQL, Redis, SMTP, and provider-owned S3, including versioning, encryption, retention, integrity, and least privilege.
2. A protected release from the current `main` commit, followed by deployment of its signed digest-qualified GHCR images to staging and rollback without rebuilding.
3. A signed isolated recovery drill proving RPO ≤15 minutes and RTO ≤4 hours (deferred by product decision).
4. Golden PSD/After Effects validation in licensed target Adobe versions (deferred by product decision).
5. Representative load and memory validation against the configured container ceilings (deferred by product decision).

The OCR scope gate is resolved for the current candidate by keeping
`PDF_REGION_OCR_ENABLED=false`. Re-enabling it requires a newly sealed holdout
that meets CER <= 25% or a separately approved claim and review policy.

The external-state audit after PR #12 found zero variables and zero secrets in
the protected `production-readiness` environment, and zero runs of both
`staging-readiness` and `provider-readiness`. No AWS/Azure credential is
available. The only configured cloud project has billing disabled, so no paid
or account-owned staging resources were created without an explicit provider,
region, domain, and budget decision.

Detailed evidence is in `artifacts/production-readiness-implementation-report-2026-07-30.md`, `artifacts/remaining-production-plan-2026-07-30.md`, `artifacts/release/release-v0.1.0.md`, `artifacts/release/release-0a2103a.md`, and `artifacts/benchmarks/ocr-arabic-corpus/latest-report.json`.

The current completion matrix, remaining priorities, acceptance criteria, and PDF fixture inventory are in `artifacts/completion-audit-and-execution-plan-2026-07-31.md`.
