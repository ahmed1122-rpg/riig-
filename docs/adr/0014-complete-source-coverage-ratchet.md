# ADR 0014: Complete-source coverage and incremental ratchet

## Status

Accepted on 2026-08-01.

## Context

The previous coverage commands measured only imported files in the API and a
hand-picked list in the web application. The reported percentages therefore
excluded production entry points, routes, clients, pages, and workspace hooks.
A high threshold over a partial denominator created false release confidence.

## Decision

- Coverage includes every production file below each workspace `src` tree.
- Test files keep Vitest's standard exclusion and are not counted as product
  coverage.
- The initial thresholds are set just below the measured complete-source
  baseline so that the truthful denominator can enter CI immediately.
- Thresholds may only move upward. Every feature or defect fix must cover its
  changed behavior, with priority given to billing, autosave/navigation,
  upload, processing, export, authentication, and production composition.
- Unit coverage is reported separately from durable integration, topology, and
  browser E2E evidence. One category does not silently substitute for another.

## Initial complete-source baseline

| Workspace | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| Web | 16.58% | 22.01% | 12.97% | 16.93% |
| API | 65.05% | 58.39% | 67.35% | 66.66% |

After adding behavioral tests for the billing return and workspace autosave
fixes, the web ratchet was raised in the same change to 23% statements, 26%
branches, 17% functions, and 23% lines. The measured values were 23.21%,
26.82%, 17.19%, and 23.71%, respectively.

## Consequences

The displayed percentages are initially lower but accurate. CI now fails when
new untested source dilutes the full application instead of hiding that source
outside the denominator. Raising the ratchet requires adding tests, not
narrowing include patterns.
