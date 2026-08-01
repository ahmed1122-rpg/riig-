# Guidance hardening implementation report

Date: 2026-08-02
Branch: `codex/guidance-hardening`

## Delivered

- The staging performance workflow now obtains its representative PDF through
  a short-lived HTTPS secret and verifies a pinned SHA-256 digest, minimum size,
  PDF signature, maximum upload limit, and workspace-confined destination
  before publishing the file to the load runner.
- Fastify has one final error boundary. Unexpected server errors are logged with
  the request ID and returned as a safe standard envelope without leaking the
  original error text. Validation and known HTTP client errors remain explicit.
- Optional OpenTelemetry OTLP/HTTP tracing creates API server spans and worker
  consumer spans. Valid W3C trace context is persisted across processing and
  export queues by migration `029_job_trace_context.sql`. Existing correlation
  IDs remain the support-facing identifier.
- PostgreSQL export reads now include `correlation_id`; previously it could be
  saved correctly but disappear when a job was read through the common select.
- A checked-out PostgreSQL client error guard prevents a database restart from
  terminating API or worker processes with an unhandled `error` event.
- The chaos gate now requires all three workers to return to `running/healthy`
  after each dependency outage, in addition to API readiness recovery.
- A maintainability ratchet rejects new production files above 500 non-empty
  lines, growth in 15 grandfathered large modules, and growth in exact clone
  blocks of at least 16 lines. ADR numbering is unique and module ownership is
  explicit.
- UX regression tests cover failed autosave followed by explicit retry,
  transient export failure followed by retry, idempotent network replay, and
  refusal to replay a non-idempotent mutation.

## Verification evidence

| Gate | Result |
|---|---|
| `npm run quality` | Passed; lint, stylelint, dead-code, all workspace typechecks, coverage, builds, bundle budget |
| API coverage run | 54 files, 209 tests passed; 66.26% statements, 58.22% branches, 68.54% functions, 67.87% lines |
| Web coverage run | 19 files, 90 tests passed; 25.10% statements, 27.91% branches, 18.65% functions, 25.72% lines |
| `npm run test:e2e` | 8/8 desktop/mobile Chromium journeys passed |
| `npm run test:topology:full` | Passed after image build, migrations, topology, dependency chaos, load, and cleanup |
| Dependency recovery | Redis, MinIO, Mailpit, and PostgreSQL outages detected; API and all workers recovered |
| Concurrent PDF smoke load | 2/2 journeys, 0% errors, workflow p95 1.335s, queue depth returned to 0 |
| Load memory observation | API RSS delta 1,220,608 bytes; heap-used delta 801,808 bytes |

The first post-change topology run exposed the checked-out PostgreSQL client
crash. That run failed both PDF journeys after the document worker exited. The
central guard and the worker-health recovery assertion were then added; the
same full topology subsequently passed. This is retained as a regression test,
not treated as successful evidence.

## External gates still open

The repository is materially stronger but is not declared production-ready by
local evidence alone. The following require deployment-owned systems or
licensed external applications:

1. Run `staging-readiness` against managed TLS PostgreSQL, Redis, SMTP, and the
   selected private S3 provider.
2. Configure a representative near-limit PDF secret, digest, minimum byte size,
   staging p95 budget, metrics endpoint, and token; run `performance-readiness`
   under realistic concurrency. The local 1,278-byte PDF is only a smoke input.
3. Configure an OTLP collector and validate sampling, collector authentication,
   retention, and alert links in staging if distributed tracing is enabled.
4. Perform and attest an isolated restore and rollback drill using the exact
   release image digests.
5. Run Adobe Golden validation in a licensed Photoshop environment and attach
   the evidence. No Adobe license was fabricated or bypassed.
6. Re-seal the Arabic OCR holdout after the current implementation/dependency
   changes before enabling regional OCR; it remains disabled.

Production publication, a new release tag, and signed image publication should
occur only after these environment-specific gates pass for the commit selected
for release.
