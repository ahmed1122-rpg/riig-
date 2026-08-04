CREATE TABLE IF NOT EXISTS project_review_approvals (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_version_id uuid NOT NULL REFERENCES source_versions(id) ON DELETE CASCADE,
  document_revision integer NOT NULL CHECK (document_revision > 0),
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id text NOT NULL CHECK (char_length(operation_id) BETWEEN 8 AND 128),
  approved_at timestamptz NOT NULL,
  UNIQUE (actor_user_id, operation_id)
);

CREATE INDEX IF NOT EXISTS project_review_approvals_project_revision_idx
  ON project_review_approvals(project_id, source_version_id, document_revision);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS current_review_approval_id uuid;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_current_review_approval_fk;
ALTER TABLE projects
  ADD CONSTRAINT projects_current_review_approval_fk
  FOREIGN KEY (current_review_approval_id)
  REFERENCES project_review_approvals(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS projects_current_review_approval_idx
  ON projects(current_review_approval_id)
  WHERE current_review_approval_id IS NOT NULL;
