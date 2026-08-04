ALTER TABLE upload_sessions
  ADD COLUMN IF NOT EXISTS integrity_failure_code text,
  ADD COLUMN IF NOT EXISTS integrity_failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS integrity_observed_content_type text,
  ADD COLUMN IF NOT EXISTS integrity_observed_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS integrity_observed_sha256 char(64);

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_integrity_failure_code_check;
ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_integrity_failure_code_check CHECK (
    integrity_failure_code IS NULL OR integrity_failure_code IN (
      'UPLOAD_OBJECT_MISSING',
      'UPLOAD_OBJECT_METADATA_INVALID',
      'UPLOAD_CONTENT_TYPE_MISMATCH',
      'UPLOAD_SIZE_MISMATCH',
      'UPLOAD_HASH_MISMATCH'
    )
  );

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_integrity_failure_pair_check;
ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_integrity_failure_pair_check CHECK (
    (integrity_failure_code IS NULL AND integrity_failed_at IS NULL)
    OR
    (integrity_failure_code IS NOT NULL AND integrity_failed_at IS NOT NULL)
  );

ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_integrity_observed_size_check;
ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_integrity_observed_size_check CHECK (
    integrity_observed_size_bytes IS NULL
    OR integrity_observed_size_bytes >= 0
  );

CREATE INDEX IF NOT EXISTS upload_sessions_reconciliation_candidates_idx
  ON upload_sessions(updated_at, upload_id)
  WHERE status IN ('verifying', 'ready');

CREATE INDEX IF NOT EXISTS upload_sessions_integrity_failures_idx
  ON upload_sessions(integrity_failed_at DESC, upload_id)
  WHERE integrity_failure_code IS NOT NULL;

CREATE TABLE IF NOT EXISTS upload_integrity_events (
  id uuid PRIMARY KEY,
  upload_id uuid NOT NULL,
  project_id uuid NOT NULL,
  source_version_id uuid,
  failure_code text NOT NULL CHECK (
    failure_code IN (
      'UPLOAD_OBJECT_MISSING',
      'UPLOAD_OBJECT_METADATA_INVALID',
      'UPLOAD_CONTENT_TYPE_MISMATCH',
      'UPLOAD_SIZE_MISMATCH',
      'UPLOAD_HASH_MISMATCH'
    )
  ),
  observed_content_type text,
  observed_size_bytes bigint CHECK (
    observed_size_bytes IS NULL OR observed_size_bytes >= 0
  ),
  observed_sha256 char(64),
  created_at timestamptz NOT NULL,
  UNIQUE (upload_id)
);

CREATE INDEX IF NOT EXISTS upload_integrity_events_created_idx
  ON upload_integrity_events(created_at DESC);
