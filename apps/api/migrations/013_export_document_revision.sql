ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS document_revision integer;

UPDATE export_jobs
SET document_revision = 1
WHERE document_revision IS NULL;

ALTER TABLE export_jobs
  ALTER COLUMN document_revision SET NOT NULL;

ALTER TABLE export_jobs
  ADD CONSTRAINT export_jobs_document_revision_positive
  CHECK (document_revision > 0);
