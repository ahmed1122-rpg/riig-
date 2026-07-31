# Production readiness

Status on 2026-07-31: the six planned editing tools are implemented and pass the local quality, durable-integration, and production-topology gates. Production approval remains withheld because the independently opened OCR holdout is red and several provider-owned release proofs are unavailable.

## Implemented locally

- Source-version restoration with actor/reason history, optimistic preconditions, idempotency, and persistent revision references.
- Persistent layer-document revisions with server-side undo/redo and bounded retention.
- PDF text split and merge with RTL-aware geometry and reading-order repair.
- Regional PDF OCR rendered from the immutable original source, worker-backed in production, with coordinate translation and atomic compare-and-swap persistence.
- Raster edge refinement and raster-layer merge as immutable derived PNG assets with integrity metadata and failed-publication cleanup.
- `PDF_REGION_OCR_ENABLED` as an emergency kill switch. Existing HTTP and worker metrics cover request status/duration, queue age/depth, retries, lease loss, and worker duration without logging source text.

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

Therefore the strict benchmark exits non-zero and the release is No-Go. The approved product claim remains: “local OCR assistant for printed Arabic documents, with mandatory human review for low-confidence or complex historical pages.” Claiming reliable manuscript or degraded-table transcription is not supported by the evidence.

## Local evidence

- `npm run quality`: passed after the final protected OCR change.
- Document-processing tests: 38/38; web tests: 62/62; all configured coverage gates passed.
- Playwright E2E: 4/4.
- Web bundle: 131.2 KiB JavaScript and 36.0 KiB CSS, gzip.
- `npm audit`: 0 known vulnerabilities across 495 dependencies.
- Fixture verification after opening: 91 OCR samples, 20 books, 136 dimensions; implementation and holdout digests match.
- Executable TODO/FIXME/HACK/NotImplemented scan: zero findings.
- `node scripts/verify-concurrent-migrations.mjs`: passed against PostgreSQL after migrations 021/022, including two simultaneous runners and an idempotent replay.
- Durable PostgreSQL/S3 suite: 8/8, covering source restoration, lease reclamation, retention, object round trips, and a real export worker.
- `npm run test:topology:full`: passed with two API replicas, PostgreSQL, Redis, versioned MinIO, Mailpit, all three workers, restart recovery, export, metrics, and a signed Stripe webhook.
- Docker runtime and web images build from digest-pinned bases. The web image passed a read-only, non-root, `cap-drop ALL`, `no-new-privileges` health smoke.
- The Windows topology runner now creates and cleans a temporary ASCII junction when the workspace path contains Unicode; the official command passed from this Arabic workspace path.

## Evidence still required

1. A protected remote and hosted CI tied to an immutable Git SHA.
2. Provider-owned S3 evidence for TLS, versioning, encryption, retention, integrity, and least privilege.
3. Signed digest deployment and rollback on staging.
4. A signed isolated recovery drill proving RPO ≤15 minutes and RTO ≤4 hours.
5. Golden PSD/After Effects validation in licensed target Adobe versions.
6. Either a passing newly sealed OCR generation or a formally approved product-scope reduction that excludes manuscripts and severely degraded tables from automatic-transcription claims.

Detailed evidence is in `artifacts/production-readiness-implementation-report-2026-07-30.md`, `artifacts/remaining-production-plan-2026-07-30.md`, and `artifacts/benchmarks/ocr-arabic-corpus/latest-report.json`.
