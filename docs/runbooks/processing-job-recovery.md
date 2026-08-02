# Runbook — Processing job recovery

## Alerts

- Processing queue wait p95 exceeds 5 minutes.
- More than 2% of jobs reach a second attempt in 15 minutes.
- `WORKER_LEASE_EXHAUSTED` appears for any job.
- A worker emits `processing.lease_lost`.
- Document OCR duration approaches `PROCESSING_LEASE_MS`.

## First checks

1. Identify `job_id`, `project_id`, `source_version_id`, worker service, attempt,
   and error code from structured logs.
2. Confirm the worker process is live and can reach PostgreSQL and object
   storage.
3. Inspect the job's `status`, `attempt`, `max_attempts`, `next_attempt_at`,
   `lease_owner`, and `lease_expires_at`.
4. Check `/internal/metrics` from the application network and compare API
   errors with worker logs.
5. Confirm the ready upload session and its object still exist for the same
   source version.
6. For PDF, check local OCR model availability and memory pressure.

## Safe recovery

- If a worker died, restart it and allow the lease to expire; another replica
  will reclaim the job automatically.
- Do not clear a live lease owned by a healthy worker.
- Reduce concurrency before retrying memory-heavy PDFs.
- A queued retry must retain its source version and idempotency identity.
- If the source object is missing, preserve the failed job and request a new
  source version; do not point the job at another file.

## Terminal failure

For `WORKER_LEASE_EXHAUSTED`:

1. Preserve logs and the job row.
2. Verify whether each attempt was a crash, timeout, or dependency failure.
3. Fix the dependency or deploy the repaired worker.
4. Use the audited administrator retry endpoint only after confirming no active
   job exists and the immutable ready source remains current. Export retries
   must also retain the exact document revision. Never change `failed` to
   `queued` or `ready` manually.

For derived raster corruption, quarantine the referenced objects and rerun the
same source version. Delete old derived objects only after the replacement
`LayerDocument` commits successfully.
