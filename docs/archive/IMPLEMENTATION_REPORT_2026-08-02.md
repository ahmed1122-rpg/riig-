# Comprehensive code review and remediation report

Date: 2026-08-02
Branch: `codex/guidance-hardening`

## Review conclusion

The repository has no known critical vulnerability, broken import boundary, or
failing release-quality gate after this pass. The review did find concrete
correctness and resource-safety defects rather than only stylistic debt:

- The configured upload limit was advertised by capabilities and Fastify but
  the upload route, service, and browser still enforced the compile-time 30 MiB
  limit. A lower production policy was therefore inconsistent across layers.
- PDF-to-PSD preparation allocated every page background and rendered every
  text layer through unbounded `Promise.all` before rejecting an oversized
  combined document.
- ZIP creation used synchronous compression in the export worker, which could
  delay lease heartbeats while building large archives.
- Base64 key validation accepted non-canonical input that Node could decode by
  ignoring invalid characters, and password verification accepted malformed
  salt/key encodings before invoking `scrypt`.
- Readiness failures did not include the request ID required by the standard
  API error envelope.
- Processing routes repeated ownership, idempotency, status-transition, and
  error-handling blocks across multiple layer mutations.

All of these findings are fixed and have regression coverage.

## Delivered

- The runtime upload limit is now validated once against the product ceiling
  and is enforced consistently by capabilities, Fastify parsing, upload
  intents, binary receipt, session metadata, client-side validation, and every
  upload-limit label. A zero/unavailable capability fails closed in the UI.
- PDF PSD export now performs aggregate-dimension and layer-pixel preflight
  before allocation and bounds page rendering to two concurrent pages and text
  rendering to four concurrent layers.
- Export archives now use asynchronous `fflate` compression, preventing the
  worker event loop from being synchronously monopolized during ZIP creation.
- Authentication keys must be canonical padded Base64 for exactly 32 bytes;
  password hashes must contain exact lowercase-hex salt and derived-key sizes.
- Health routes, export error types, PSD dimension guards, PDF preflight,
  concurrency control, workspace public props, export quality summary, and
  processing route contracts were separated into focused modules.
- Five layer-edit endpoints now share one ownership/idempotency/status/error
  pipeline. The first maintainability pass improved from 15 to 14
  grandfathered oversized files and from 8 clone blocks/147 cloned lines to 1
  block/17 lines. The completed modularization pass reduced that further to
  zero oversized files and zero exact clone blocks.
- `app.ts` moved below the 500-source-line ceiling. Other reductions include
  processing routes 761→578, export service 949→920, export adapter 708→677,
  export review 712→697, while `Workspace.tsx` moved from 1307 to the
  500-source-line ceiling.
- `packages/document-processing/src/index.ts` is now a stable barrel over
  cohesive OCR, PDF-region, PDF-layout, and PDF-source modules. Package imports
  remain unchanged, every new production module is below 500 source lines, and
  PDF page cleanup now runs from a per-page `finally` boundary.
- `processing-service.ts` moved below the 500-line ceiling after extracting the
  document edit coordinator, integrity-checking raster store, image-layer
  operations, PDF-layer operations, and layer-state operations. Its public
  service methods and route contracts remain unchanged.
- `export-service.ts` moved from 920 to 477 source lines. Artifact construction
  is isolated in a 398-line builder, while expiration, integrity validation,
  buffered reads, and streaming reads are isolated in a 95-line reader. Public
  service methods, storage keys, lease behavior, and artifact formats remain
  compatible.
- `processing-worker-runtime.ts` moved from 829 to 264 source lines. PostgreSQL
  claiming is isolated in a 99-line module and claimed-job execution,
  persistence, retry, lease-loss handling, and metering in a 487-line module.
  The previous `claimNextProcessingJob` import remains available through a
  compatibility re-export.
- `processing-routes.ts` moved from 578 to 470 source lines after extracting
  job/document/asset read routes into a 121-line registrar. HTTP paths, cache
  headers, ETags, ownership checks, and error envelopes remain unchanged.
- `auth-service.ts` moved from 553 to the 500-source-line ceiling after
  extracting password reset/change coordination. Reset-delivery privacy,
  token hashing, credential revocation, repository contracts, and public
  service methods remain unchanged.
- `PdfGuidanceEditor.tsx` moved from 534 to 389 source lines by isolating its
  pointer-capture marker overlay and region labels in a 193-line component.
  Region thresholds, normalized coordinates, selection, reading order, and
  editor callbacks remain compatible.
- `verify-deployment.mjs` moved from 515 to 463 source lines by extracting the
  deployment-artifact inventory. Its worker reliability scan now follows the
  split runtime, executor, and claim modules instead of assuming one file.
- `LayerDock.tsx` moved from 577 to 443 source lines by isolating memoized row,
  loading-skeleton, and checks-panel rendering in a 267-line component module.
  Keyboard navigation, drag/drop, inline rename, visibility, locking, and
  accessibility labels remain compatible.
- `ExportReview.tsx` moved from 697 to the 500-line ceiling by extracting its
  previews, modal focus isolation, and header. `BillingPortal.tsx` moved from
  606 to 466 lines by extracting the hosted-checkout dialog and state views.
- `packages/contracts/src/index.ts` is now a three-line stable barrel over
  core, layer/guidance, and workflow contracts. The export-adapter entry point
  moved from 677 to 308 lines by isolating PDF-to-PSD generation and shared PSD
  buffer helpers. Existing package imports and generated artifact behavior are
  unchanged.
- The final 17-line duplicate guidance-editor import block was removed by
  publishing the shared editor contract through `GuidanceEditorShared.tsx`.
- `Workspace.tsx` now coordinates focused project-lifecycle, command,
  navigation-guard, tool-controller, document-adoption, source-restoration,
  layer-mutation, editor-layout, and dialog modules. Upload cleanup, source
  restoration, history/refinement/export commands, keyboard dispatch, and
  layer-operation validation retain their existing public routes and UI
  contracts. Focused adoption and navigation-guard tests raise the web suite
  from 92 to 95 tests.

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
  lines and any exact clone block of at least 16 lines. There are no remaining
  grandfathered oversized files; ADR numbering is unique and module ownership
  is explicit.
- UX regression tests cover failed autosave followed by explicit retry,
  transient export failure followed by retry, idempotent network replay, and
  refusal to replay a non-idempotent mutation.

## Verification evidence

| Gate | Result |
|---|---|
| `npm run quality` | Passed; lint, stylelint, dead-code, all workspace typechecks, coverage, builds, bundle budget |
| API coverage run | 56 files, 219 tests passed; 67.01% statements, 58.50% branches, 68.97% functions, 68.64% lines |
| Web coverage run | 22 files, 95 tests passed; 25.78% statements, 28.11% branches, 19.40% functions, 26.12% lines |
| Export adapter | 16 tests passed; 93.26% statements, 87.87% branches, 88.88% functions, 93.93% lines |
| `npm run test:e2e` | 8/8 desktop/mobile Chromium journeys passed |
| `npm run test:topology:full` | Passed after image build, migrations, topology, dependency chaos, load, and cleanup |
| Dependency recovery | Redis, MinIO, Mailpit, and PostgreSQL outages detected; API and all workers recovered |
| Concurrent PDF smoke load | 2/2 journeys, 0% errors, workflow p95 1.322s, queue depth returned to 0 |
| Load memory observation | API RSS delta 1,040,384 bytes; heap-used delta 1,332,496 bytes |
| Production dependency audit | 0 vulnerabilities across 695 resolved dependencies |

The first post-change topology run exposed the checked-out PostgreSQL client
crash. That run failed both PDF journeys after the document worker exited. The
central guard and the worker-health recovery assertion were then added; the
same full topology subsequently passed. This is retained as a regression test,
not treated as successful evidence.

## Remaining engineering backlog

The following items are real improvement work, but none should be represented
as already completed or as a release blocker without the stated condition:

1. Raise browser-unit coverage from the current 25.78% by testing the workspace
   upload hook, application/session boundaries, source upload states, and the
   large workspace orchestration component. The desktop/mobile E2E coverage is
   strong, but it is slower and less diagnostic than focused component tests.
2. Add cursor pagination to project, export, upload, and user/admin listing
   contracts. The current PostgreSQL repositories return unbounded result sets
   for several list operations; this is a scale risk, not a present correctness
   failure at the verified local load.
3. Run a representative near-limit PDF benchmark with sustained concurrency,
   enforce a finite workflow p95 budget, and capture worker RSS/CPU. The local
   1,278-byte fixture proves the workflow and recovery, not production capacity.
4. Schedule minor dependency upgrades as a separate change with bundle and
   behavioral comparison. Do not combine TypeScript 7, Zod 4, or other major
   upgrades with release hardening; the current production dependency audit is
   clean.

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

### Signed-image rollback rehearsal added after the initial report

The repository now includes `release-rollback-drill`, which verifies the exact
candidate and previous-release signatures, deploys the candidate digests on the
production-shaped topology, completes a PDF upload/process/export/download
journey, and then recreates only the application services on the previous
digests. It deliberately retains forward additive migrations instead of
starting an older migration image. The local rehearsal from `v0.1.3-rc.1` to
`v0.1.2` passed both release-identity checks, both web health checks, and both
PDF journeys; `.tmp/release-rollback-evidence.json` records the result. The
protected GitHub workflow remains the authoritative retained evidence once it
passes on a clean runner with Cosign installed.
5. Run Adobe Golden validation in a licensed Photoshop environment and attach
   the evidence. No Adobe license was fabricated or bypassed.
6. Re-seal the Arabic OCR holdout after the current implementation/dependency
   changes before enabling regional OCR; it remains disabled.

Production publication, a new release tag, and signed image publication should
occur only after these environment-specific gates pass for the commit selected
for release.
