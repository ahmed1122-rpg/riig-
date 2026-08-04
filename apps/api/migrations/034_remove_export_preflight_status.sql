UPDATE export_jobs
SET status = 'failed',
    error_code = COALESCE(error_code, 'LEGACY_PREFLIGHT_INTERRUPTED'),
    updated_at = now()
WHERE status = 'preflight';

ALTER TABLE export_jobs
  DROP CONSTRAINT IF EXISTS export_jobs_status_check;
ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_status_check CHECK (
    status IN (
      'queued', 'generating', 'verifying', 'ready', 'failed', 'cancelled'
    )
  );
