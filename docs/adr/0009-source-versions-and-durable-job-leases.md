# ADR 0009 — Source versions and durable job leases

## Context

Replacing a source previously risked creating a disconnected project, while a
worker crash could leave a processing or export job permanently active. Image
and document workers also duplicated their PostgreSQL claim and lifecycle code.

## Decision

1. Store each accepted upload as a numbered `source_versions` row and keep an
   explicit current-source pointer on the project.
2. Keep all source replacements inside the same project and expose their
   history to the owner.
3. Persist `attempt`, `max_attempts`, `next_attempt_at`, `lease_owner`, and
   `lease_expires_at` on processing and export jobs.
4. Claim work atomically with `FOR UPDATE SKIP LOCKED`, renew the lease during
   processing, and condition every final write on ownership of a live lease.
5. Retry failures with bounded exponential delay. Recover expired leases and
   mark exhausted jobs with a stable error code.
6. Share one processing-worker runtime between image and PDF entrypoints. Keep
   the export runtime separate because its cancellation and artifact lifecycle
   are materially different.

## Consequences

- A worker can restart without manual database edits or permanently stranded
  jobs.
- Horizontal worker replicas do not process the same live claim.
- An old worker that loses its lease cannot overwrite a newer result.
- Operators can distinguish a transient retry from terminal failure.
- Migrations 009, 010, and 012 must be applied before the corresponding
  application version starts.
- PostgreSQL integration tests remain a release requirement; in-memory tests do
  not prove locking semantics.

## Rollback

Roll application images back first while keeping the additive columns and
tables. Do not drop lease or source-version columns during an incident. A
forward migration may remove them only after all older application versions
are retired and their data has been archived.
