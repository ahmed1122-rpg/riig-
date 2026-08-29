# Source-preserving Character Rig execution and completion audit

Started: 2026-08-28
Completed: 2026-08-29
Branch: `codex/source-preserving-cleanup-v0.1.9`
Baseline commit: `709e6fe`

## Worktree safety boundary

The worktree was already intentionally dirty before the source-preserving
change. Docker hardening, accessibility, guidance, dashboard, RunPod evidence,
and provider work predate this execution. They must not be reset or deleted as
part of Character Rig cleanup without independent usage evidence.

The Character Rig implementation scope is limited to:

- Character contracts, references, compilation, routes, worker runtime, and
  their tests.
- Character Studio UI/controller/client and their tests.
- PSD adapter integrity verification.
- Character worker source-only configuration.
- ADR 0020 and directly affected operations documentation.

## Product invariant

The current upload is the sole visual source. Visible exported layers must
reproduce the decoded source RGBA pixel-for-pixel. Identity training, generated
views, replacement faces, and invented occluded parts are outside the product
workflow and must fail closed.

## Non-destructive cleanup rule

A file or setting may be removed only after repository search, build graph,
runtime configuration, tests, CI, Docker, and documentation show that it has no
supported consumer. Broad `git restore`, recursive deletion, and cleanup based
only on a missing TypeScript import are prohibited in this dirty worktree.

## Initial verification baseline

- Workspace typecheck was run after the first implementation pass.
- Two local type errors were found and corrected: an unused legacy test helper
  and an uninitialized React ref.
- Targeted source-preserving compiler, mismatch, PSD, client, and UI tests had
  previously passed 19/19 before the worker source-only gate was added.
- Full quality, Docker, and browser verification were required before release
  and are recorded below.

## Completion evidence

- `npm run quality` completed with exit code 0 after architecture, contract,
  maintainability, deployment, recovery, incident, security, license, path,
  release, evidence, promotion, load, cleanup, CSS, icon, fixture, visual,
  Adobe Golden, Character benchmark, lint, typecheck, coverage, build, and
  bundle-budget gates.
- API coverage completed across 122 test files and 534 tests. Web coverage
  completed across 86 test files and 302 tests. Package and worker coverage
  gates also passed.
- The production web bundle passed its budget at 183.7 KiB JavaScript and
  44.8 KiB CSS, with 9 landing-page requests, a 207.0 KiB hero budget, and no
  bundled fonts.
- Docker Desktop was upgraded with its signed updater to 4.88.1. Docker Engine
  29.7.2 and Docker Compose 5.4.0 were used for live image and Compose checks.
- The runtime and web images built successfully on Linux. The runtime image ran
  as UID 1000, contained no npm executable or TypeScript source, and passed the
  internal Adobe Golden byte comparison.
- An isolated Compose project started PostgreSQL, Redis, MinIO, ClamAV,
  Mailpit, two API instances, and every supported worker including
  `worker-character`. APIs were healthy, exposed the expected release SHA, and
  protected internal metrics with an authentication token.
- Runtime containers were read-only, dropped all Linux capabilities, enabled
  `no-new-privileges`, and applied a PID limit. The web image was also exercised
  with the hardened runtime policy and returned the expected CSP and COOP
  headers.
- Browser verification loaded the supported pages without console errors.
- The isolated Compose project, validation images, build output, coverage,
  TypeScript build metadata, Playwright output, and private source-map output
  were removed. Global Docker data and unrelated user files were not pruned.
- A final repository scan found no active RunPod, InsightFace, FaceID, provider,
  identity-training, or image-generation implementation. Remaining legacy job
  names exist only for migration compatibility and tests and are rejected by
  the source-only product workflow.

## Release conclusion

All automated gates available in this repository pass at this revision of the
worktree. This is evidence of a zero-failing-gate state, not a claim that future
software can never contain an undiscovered defect. Character Rig now fails
closed whenever source pixel identity cannot be proven.
