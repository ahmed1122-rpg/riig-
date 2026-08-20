# Repository deep-remediation result

**Date:** 2026-08-16

**Branch:** `codex/pdf-tree-performance`

**Status:** local source candidate; not production approval

## Remaining-work completion update

The second remediation pass completed the repository-wide early-warning
backlog rather than merely holding the strict cap. All 28 production files
previously in the 450–550 line warning band were split along existing domain,
adapter, presentation, and workflow boundaries. Shared contracts were moved to
cycle-free type modules, and the deployment/topology verifiers were separated
into focused, reusable checks. The authenticated project and export routes now
share one lazy production chunk while the public entry and dashboard remain
independent.

## Implemented

- Repaired tracked Markdown evidence links and replaced developer-machine paths
  with repository-relative or opaque, SHA-bound evidence references.
- Added fail-fast path, CSS-usage, icon-usage, and worker production-build
  verifiers to the root quality gate, with regression tests.
- Excluded test modules from the media and document worker production output and
  expanded the safe cleanup contract for ignored reports, maps, and dogfood
  output.
- Removed reviewed unused CSS selectors and the unconsumed `book` icon.
- Moved PostgreSQL job claiming into the infrastructure adapter, made processing
  execution depend on the `UsageMeter` port, and centralized transaction
  handling with rollback-failure preservation.
- Moved reusable stored preferences, PDF segmentation, and export presentation
  outside feature-to-feature boundaries and added an architecture rule that
  rejects future cross-feature production imports.
- Made workspace tool dispatch exhaustive and added a registry-to-controller
  contract covering every registered tool.
- Added authenticated Security and administrator control-room browser coverage,
  including accessibility checks for every administrator section.
- Organized current documentation, historical implementation reports, and
  artifact-retention guidance into explicit locations.

## Verification

- `npm run quality`: PASS, including architecture, contracts, deployment,
  recovery, incident, security-license, paths, assets, lint, dead-code analysis,
  typecheck, all workspace coverage suites, production builds, and bundle budget.
- Desktop Chromium production-preview E2E: 8/8 PASS, including real seeded-admin
  navigation and authenticated Security.
- Live Chromium WCAG A/AA checks: zero violations for the public entry, Security,
  and administrator overview; browser error log empty.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities.
- API coverage ratchet: 69% statements, 62% branches, 71% functions, 70% lines.
- Web coverage ratchet: 56% statements, 53% branches, 49% functions, 58% lines.
- Bundle: 184.6 KiB gzip JavaScript and 45.1 KiB gzip CSS; landing remains nine
  requests, a 207.0 KiB hero, and zero blocking font requests.
- Maintainability: zero exact clone blocks and zero files above the 550-line
  strict cap, zero grandfathered files, and zero files in the 450–550
  early-warning band.
- Production-shaped local topology: PASS with two API replicas, PostgreSQL,
  Redis, MinIO/S3, Mailpit, media/document/export workers, restart verification,
  cross-replica signed Stripe webhook idempotency, export download, and trace
  identity checks.
- Dependency fault/recovery drill: PASS for Redis (3.772 s), MinIO (11.712 s),
  Mailpit (49.705 s), and PostgreSQL (13.906 s), including readiness, worker,
  and provider-metric recovery.
- Concurrent PDF workflow smoke: 2/2 journeys passed, 0% errors, workflow P95
  1.458 s, peak queue depth 1, final queue depth 0, API RSS peak delta 256 KiB,
  and no worker RSS growth.

## Deliberately not claimed

The local topology, fault, and smoke-load evidence above is not release-bound:
it used the integration identity rather than an immutable published image
digest. This pass still does not provide managed PostgreSQL/S3 evidence,
immutable staging deployment, signed managed recovery/rollback drills, the
protected representative load policy, live Stripe-provider webhook evidence,
external OCR/Character-Rig provider qualification, or owner/legal approval.
Those gates must pass for the same full Git SHA and immutable image digests
before production approval.

Seven pre-existing local screenshot deletions are included in this remediation
commit with explicit user authorization. Historical reports no longer retain
broken links to the deleted evidence.
