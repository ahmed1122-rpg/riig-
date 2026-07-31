CREATE TABLE IF NOT EXISTS source_version_restore_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  from_source_version_id uuid NOT NULL REFERENCES source_versions(id) ON DELETE RESTRICT,
  to_source_version_id uuid NOT NULL REFERENCES source_versions(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 3 AND 500),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 8 AND 128),
  created_at timestamptz NOT NULL,
  CHECK (from_source_version_id <> to_source_version_id),
  UNIQUE (actor_user_id, request_id)
);

CREATE INDEX IF NOT EXISTS source_version_restore_events_project_created_idx
  ON source_version_restore_events(project_id, created_at DESC);
