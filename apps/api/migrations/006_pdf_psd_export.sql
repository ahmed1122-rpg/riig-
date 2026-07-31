ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS selected_page integer
  CHECK (selected_page IS NULL OR selected_page > 0);
