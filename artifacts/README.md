# Artifact retention map

This directory contains tracked fixtures and review evidence. Generated local
output belongs in ignored paths such as `artifacts/playwright/`,
`artifacts/qa/`, `artifacts/private-sourcemaps/`, or `dogfood-output/` and is
removed by `npm run clean`.

## Keep in Git

- `fixtures/`: deterministic unit, integration, and browser inputs.
- `benchmarks/`: capacity, OCR, and character-quality measurements with their
  manifests and digests.
- `baselines/`: reviewed machine-verifiable limits.
- `adobe-golden/`: licensed-application evidence and reproducible PSD fixtures.
- `release/`: release-bound manifests; their SHA/digest identity remains
  authoritative only for the release named inside each manifest.

## Dated review evidence

Folders prefixed with `browser-qa`, `dogfood`, `phase`, `professional`, or a
feature/date name are historical UX evidence. Their reports must use relative
links and must not contain developer-machine paths. A missing screenshot must
be documented in the report instead of leaving a broken link.

New large screenshots and videos should normally be uploaded as CI or GitHub
release artifacts. Commit them here only when a test, release decision, legal
record, or regression investigation requires long-term in-repository access.
