-- Fence asynchronous project status updates to the job that currently owns
-- the project activity. The identifiers deliberately have no foreign key:
-- they can refer to either processing_jobs or export_jobs and are cleared
-- when the activity finishes or a source change supersedes it.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS active_job_type text,
  ADD COLUMN IF NOT EXISTS active_job_id uuid;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_active_job_pair_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_active_job_pair_check CHECK (
    (active_job_type IS NULL AND active_job_id IS NULL)
    OR (
      active_job_type IN ('processing', 'export')
      AND active_job_id IS NOT NULL
    )
  );

CREATE INDEX IF NOT EXISTS projects_active_job_idx
  ON projects (active_job_type, active_job_id)
  WHERE active_job_id IS NOT NULL;
