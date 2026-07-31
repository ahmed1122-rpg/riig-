CREATE TABLE IF NOT EXISTS layer_document_revisions (
  project_id uuid NOT NULL,
  source_version_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, source_version_id, revision),
  FOREIGN KEY (project_id, source_version_id)
    REFERENCES layer_documents(project_id, source_version_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS layer_document_revisions_created_idx
  ON layer_document_revisions(project_id, source_version_id, created_at DESC);
