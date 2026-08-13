# ADR 0016: Maintainability debt ratchet

## Status

Accepted on 2026-08-02.

## Context

Several production modules predate explicit size and duplication boundaries.
Failing CI immediately on every existing large file would make the quality gate
unusable, while checking only lint and dead exports would allow those modules
and exact clones to keep growing.

## Decision

- Production JavaScript and TypeScript under `apps`, `packages`, and `scripts`
  are measured by `scripts/verify-maintainability.mjs`.
- A production file emits a non-blocking early warning at 450 non-empty lines
  and may not exceed the strict cap of 550 non-empty lines.
- Existing oversized files are recorded with per-file caps in
  `config/maintainability-baseline.json`; they may shrink but may not grow.
- Exact duplicated blocks of at least 16 normalized source lines use global
  block and line budgets. Both budgets may only move downward.
- Tests are excluded from the debt measurement because deliberate fixture and
  scenario repetition should not consume the production-code budget.
- A justified temporary exception requires an ADR with an owner and removal
  date. Editing the baseline to accommodate ordinary feature growth is not an
  exception process.

## Consequences

CI prevents new large modules and measurable exact-clone growth without
pretending the existing debt has already been removed. Refactoring can reduce
the baseline incrementally. The detector intentionally covers exact clones;
architectural coupling remains enforced separately by the import-boundary and
cycle checks.
