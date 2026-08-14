CREATE TABLE IF NOT EXISTS character_rig_reviews (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rig_version_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 2000),
  reviewer_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id text NOT NULL CHECK (char_length(operation_id) BETWEEN 8 AND 128),
  document jsonb NOT NULL CHECK (jsonb_typeof(document) = 'object'),
  created_at timestamptz NOT NULL,
  UNIQUE (reviewer_user_id, operation_id),
  FOREIGN KEY (rig_version_id, project_id)
    REFERENCES character_rig_versions(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS character_rig_reviews_version_created_idx
  ON character_rig_reviews(rig_version_id, created_at);
