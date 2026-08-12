CREATE TABLE IF NOT EXISTS derived_asset_registry (
  object_key text PRIMARY KEY CHECK (
    char_length(object_key) BETWEEN 1 AND 1024
    AND object_key LIKE 'derived/%'
  ),
  project_id uuid NOT NULL,
  owner_user_id uuid NOT NULL,
  category text NOT NULL CHECK (category IN ('processing', 'tool', 'guidance')),
  registered_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  purged_at timestamptz
);

CREATE INDEX IF NOT EXISTS derived_asset_registry_cleanup_idx
  ON derived_asset_registry(updated_at, object_key)
  WHERE purged_at IS NULL;

CREATE INDEX IF NOT EXISTS derived_asset_registry_owner_idx
  ON derived_asset_registry(owner_user_id, object_key)
  WHERE purged_at IS NULL;
