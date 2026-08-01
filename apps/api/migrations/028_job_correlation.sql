ALTER TABLE processing_jobs
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS processing_jobs_correlation_idx
  ON processing_jobs(correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS export_jobs_correlation_idx
  ON export_jobs(correlation_id)
  WHERE correlation_id IS NOT NULL;
