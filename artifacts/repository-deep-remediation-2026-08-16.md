# Repository deep-remediation result

**Date:** 2026-08-16

**Branch:** `codex/pdf-tree-performance`

**Status:** local source candidate; not production approval

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
- Bundle: 184.1 KiB gzip JavaScript and 45.1 KiB gzip CSS; landing remains eight
  requests, a 207.0 KiB hero, and zero blocking font requests.
- Maintainability: zero exact clone blocks and zero files above the 550-line
  strict cap. Twenty-eight files remain in the 450–550 early-warning band and
  are protected from growth by the existing ratchet.

## Deliberately not claimed

This pass does not provide managed PostgreSQL/S3 evidence, immutable staging
deployment, signed recovery/rollback drills, representative concurrent PDF load,
live Stripe webhook evidence, external OCR/Character-Rig provider qualification,
or owner/legal approval. Those release-bound gates must pass for the same full
Git SHA and immutable image digests before production approval.

Seven pre-existing local screenshot deletions are included in this remediation
commit with explicit user authorization. Historical reports no longer retain
broken links to the deleted evidence.
