ALTER TABLE processing_jobs
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0
    CHECK (attempt >= 0),
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3
    CHECK (max_attempts BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS processing_jobs_claim_idx
  ON processing_jobs(project_kind, next_attempt_at, created_at)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS processing_jobs_expired_lease_idx
  ON processing_jobs(project_kind, lease_expires_at)
  WHERE status IN ('processing', 'verifying');
