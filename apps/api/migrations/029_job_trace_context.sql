ALTER TABLE processing_jobs
  ADD COLUMN IF NOT EXISTS trace_parent varchar(55),
  ADD COLUMN IF NOT EXISTS trace_state varchar(512);

ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS trace_parent varchar(55),
  ADD COLUMN IF NOT EXISTS trace_state varchar(512);
