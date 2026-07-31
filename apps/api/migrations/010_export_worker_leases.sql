ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS project_kind text,
  ADD COLUMN IF NOT EXISTS scale integer,
  ADD COLUMN IF NOT EXISTS color_profile text,
  ADD COLUMN IF NOT EXISTS naming_preset_id text,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS max_attempts integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS lease_owner text,
  ADD COLUMN IF NOT EXISTS lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS error_code text;

UPDATE export_jobs AS job
SET
  project_kind = project.kind,
  scale = 1,
  color_profile = 'sRGB',
  naming_preset_id = 'adobe-default'
FROM projects AS project
WHERE project.id = job.project_id
  AND (
    job.project_kind IS NULL OR
    job.scale IS NULL OR
    job.color_profile IS NULL OR
    job.naming_preset_id IS NULL
  );

ALTER TABLE export_jobs
  ALTER COLUMN project_kind SET NOT NULL,
  ALTER COLUMN scale SET NOT NULL,
  ALTER COLUMN color_profile SET NOT NULL,
  ALTER COLUMN naming_preset_id SET NOT NULL;

ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_project_kind_check
    CHECK (project_kind IN ('image', 'book')),
  ADD CONSTRAINT export_jobs_scale_check
    CHECK (scale IN (1, 2)),
  ADD CONSTRAINT export_jobs_color_profile_check
    CHECK (color_profile IN ('sRGB', 'display-p3')),
  ADD CONSTRAINT export_jobs_attempt_check
    CHECK (attempt >= 0 AND attempt <= max_attempts),
  ADD CONSTRAINT export_jobs_max_attempts_check
    CHECK (max_attempts BETWEEN 1 AND 10);

CREATE INDEX IF NOT EXISTS export_jobs_claimable_idx
  ON export_jobs(next_attempt_at, created_at)
  WHERE status IN ('queued', 'generating', 'verifying');
