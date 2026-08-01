# ADR 0012: Atomic upload publication and reconciliation

## Status

Accepted on 2026-08-01.

## Context

Upload verification previously advanced the upload, source version, and
project through separate repository writes. A crash between writes could leave
verified bytes in object storage with contradictory database state.

## Decision

PostgreSQL production mode finalizes all three records in one transaction while
holding the relevant rows. Replays are idempotent and never regress a project
that has already advanced to review or a later job state. A bounded startup and
periodic reconciler selects only inconsistent candidates, re-inspects the
private object, validates content type, size, and any existing SHA-256, and then
invokes the same atomic command.

In-memory mode serializes finalization and preserves the same replay semantics
for development and tests.

## Consequences

- A verified upload is either fully published or not published.
- Database recovery cannot assert source readiness without matching object
  metadata.
- Reconciliation is safe to run on every API replica, but selection and
  finalization must remain bounded and idempotent.
- Migration compatibility is preserved because no existing upload columns are
  removed or reinterpreted.

## Verification

The durable integration suite injects a mid-transaction failure, proves all
writes roll back, replays successfully, and proves progressed project state is
not regressed. The production topology exercises upload through two API
replicas and versioned MinIO.
