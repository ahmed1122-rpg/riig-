ALTER TABLE account_deletion_requests
  ADD COLUMN IF NOT EXISTS phase text NOT NULL DEFAULT 'draining'
    CHECK (phase IN ('draining', 'purging', 'completed')),
  ADD COLUMN IF NOT EXISTS object_prefixes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS drained_at timestamptz,
  ADD COLUMN IF NOT EXISTS inventory_object_count integer NOT NULL DEFAULT 0
    CHECK (inventory_object_count >= 0),
  ADD COLUMN IF NOT EXISTS inventory_digest char(64)
    CHECK (inventory_digest IS NULL OR inventory_digest ~ '^[a-f0-9]{64}$'),
  ADD COLUMN IF NOT EXISTS processor_lease_id uuid,
  ADD COLUMN IF NOT EXISTS processor_lease_expires_at timestamptz;

UPDATE account_deletion_requests
SET phase = CASE WHEN status = 'completed' THEN 'completed' ELSE 'draining' END
WHERE phase IS DISTINCT FROM
  CASE WHEN status = 'completed' THEN 'completed' ELSE 'draining' END;

UPDATE account_deletion_requests request
SET object_prefixes = inventory.object_prefixes
FROM (
  SELECT deletion.id,
         COALESCE(
           array_agg(prefix.value ORDER BY prefix.value)
             FILTER (WHERE prefix.value IS NOT NULL),
           '{}'::text[]
         ) AS object_prefixes
  FROM account_deletion_requests deletion
  LEFT JOIN projects project ON project.owner_user_id = deletion.user_id
  LEFT JOIN LATERAL (
    VALUES
      ('sources/' || project.id::text || '/'),
      ('artifacts/' || project.id::text || '/'),
      ('derived/' || project.id::text || '/'),
      ('projects/' || project.id::text || '/')
  ) prefix(value) ON project.id IS NOT NULL
  WHERE deletion.status <> 'completed'
  GROUP BY deletion.id
) inventory
WHERE request.id = inventory.id
  AND cardinality(request.object_prefixes) = 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'account_deletion_requests_completed_phase_check'
      AND conrelid = 'account_deletion_requests'::regclass
  ) THEN
    ALTER TABLE account_deletion_requests
      ADD CONSTRAINT account_deletion_requests_completed_phase_check
      CHECK ((status = 'completed') = (phase = 'completed')) NOT VALID;
  END IF;
END;
$$;

ALTER TABLE account_deletion_requests
  VALIDATE CONSTRAINT account_deletion_requests_completed_phase_check;

CREATE TABLE IF NOT EXISTS object_write_leases (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  object_key text NOT NULL CHECK (char_length(object_key) BETWEEN 1 AND 2048),
  writer_type text NOT NULL CHECK (
    writer_type IN ('upload', 'export', 'character', 'derived')
  ),
  state text NOT NULL CHECK (state IN ('writing', 'cooldown')),
  acquired_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > acquired_at)
);

CREATE INDEX IF NOT EXISTS object_write_leases_owner_expiry_idx
  ON object_write_leases(owner_user_id, expires_at, id);

ALTER TABLE upload_sessions
  ADD COLUMN IF NOT EXISTS purge_claimed_at timestamptz;

ALTER TABLE export_jobs
  ADD COLUMN IF NOT EXISTS purge_claimed_at timestamptz;

ALTER TABLE character_reference_assets
  ADD COLUMN IF NOT EXISTS purge_claimed_at timestamptz;

ALTER TABLE derived_asset_registry
  ADD COLUMN IF NOT EXISTS purge_claimed_at timestamptz;

CREATE INDEX IF NOT EXISTS account_deletion_requests_phase_idx
  ON account_deletion_requests(phase, updated_at, id)
  WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS account_deletion_requests_processor_lease_idx
  ON account_deletion_requests(processor_lease_expires_at, updated_at, id)
  WHERE status <> 'completed';

CREATE INDEX IF NOT EXISTS derived_asset_registry_purge_claim_idx
  ON derived_asset_registry(purge_claimed_at, updated_at, object_key)
  WHERE purged_at IS NULL;

CREATE OR REPLACE FUNCTION require_writable_project_owner(target_project_id uuid)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  writable_owner_id uuid;
BEGIN
  SELECT owner.id INTO writable_owner_id
  FROM projects project
  JOIN users owner ON owner.id = project.owner_user_id
  WHERE project.id = target_project_id
    AND owner.deletion_requested_at IS NULL
    AND owner.deleted_at IS NULL
  FOR KEY SHARE OF owner;

  IF writable_owner_id IS NULL THEN
    RAISE EXCEPTION 'account deletion has disabled project writes'
      USING ERRCODE = '55000';
  END IF;
  RETURN writable_owner_id;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_tombstoned_project_work()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM require_writable_project_owner(NEW.project_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION validate_object_write_lease_owner()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  writable_owner_id uuid;
BEGIN
  writable_owner_id := require_writable_project_owner(NEW.project_id);
  IF NEW.owner_user_id IS DISTINCT FROM writable_owner_id THEN
    RAISE EXCEPTION 'object write lease owner does not match its project'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS object_write_leases_validate_owner
  ON object_write_leases;
CREATE TRIGGER object_write_leases_validate_owner
BEFORE INSERT OR UPDATE OF project_id, owner_user_id ON object_write_leases
FOR EACH ROW EXECUTE FUNCTION validate_object_write_lease_owner();

CREATE OR REPLACE FUNCTION prevent_tombstoned_project_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM owner.id FROM users owner
  WHERE owner.id = NEW.owner_user_id
    AND owner.deletion_requested_at IS NULL
    AND owner.deleted_at IS NULL
  FOR KEY SHARE OF owner;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account deletion has disabled new projects'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_prevent_tombstoned_insert ON projects;
CREATE TRIGGER projects_prevent_tombstoned_insert
BEFORE INSERT ON projects
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_project_insert();

CREATE OR REPLACE FUNCTION prevent_tombstoned_billable_subscription()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status NOT IN ('trialing', 'active', 'past_due') THEN
    RETURN NEW;
  END IF;
  PERFORM owner.id FROM users owner
  WHERE owner.id = NEW.user_id
    AND owner.deletion_requested_at IS NULL
    AND owner.deleted_at IS NULL
  FOR KEY SHARE OF owner;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account deletion has disabled billable subscriptions'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_prevent_tombstoned_billable_transition
  ON subscriptions;
CREATE TRIGGER subscriptions_prevent_tombstoned_billable_transition
BEFORE INSERT OR UPDATE OF status ON subscriptions
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_billable_subscription();

DROP TRIGGER IF EXISTS processing_jobs_prevent_tombstoned_insert
  ON processing_jobs;
CREATE TRIGGER processing_jobs_prevent_tombstoned_insert
BEFORE INSERT ON processing_jobs
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_project_work();

DROP TRIGGER IF EXISTS export_jobs_prevent_tombstoned_insert ON export_jobs;
CREATE TRIGGER export_jobs_prevent_tombstoned_insert
BEFORE INSERT ON export_jobs
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_project_work();

DROP TRIGGER IF EXISTS character_jobs_prevent_tombstoned_insert
  ON character_jobs;
CREATE TRIGGER character_jobs_prevent_tombstoned_insert
BEFORE INSERT ON character_jobs
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_project_work();

DROP TRIGGER IF EXISTS upload_sessions_prevent_tombstoned_insert
  ON upload_sessions;
CREATE TRIGGER upload_sessions_prevent_tombstoned_insert
BEFORE INSERT ON upload_sessions
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_project_work();

DROP TRIGGER IF EXISTS character_references_prevent_tombstoned_insert
  ON character_reference_assets;
CREATE TRIGGER character_references_prevent_tombstoned_insert
BEFORE INSERT ON character_reference_assets
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_project_work();

DROP TRIGGER IF EXISTS derived_assets_prevent_tombstoned_insert
  ON derived_asset_registry;
CREATE TRIGGER derived_assets_prevent_tombstoned_insert
BEFORE INSERT ON derived_asset_registry
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_project_work();

CREATE OR REPLACE FUNCTION prevent_claimed_upload_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'ready' AND OLD.status <> 'ready' THEN
    PERFORM require_writable_project_owner(NEW.project_id);
    IF OLD.purge_claimed_at IS NOT NULL THEN
      RAISE EXCEPTION 'upload object is already claimed for retention purge'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS upload_sessions_prevent_claimed_publication
  ON upload_sessions;
CREATE TRIGGER upload_sessions_prevent_claimed_publication
BEFORE UPDATE OF status ON upload_sessions
FOR EACH ROW EXECUTE FUNCTION prevent_claimed_upload_publication();

CREATE OR REPLACE FUNCTION lock_layer_document_object_keys()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  referenced_key text;
  claimed_at timestamptz;
  deleted_at timestamptz;
BEGIN
  PERFORM require_writable_project_owner(NEW.project_id);
  FOR referenced_key IN
    SELECT DISTINCT value #>> '{}'
    FROM jsonb_path_query(NEW.document, '$.**.objectKey') value
    WHERE value #>> '{}' <> ''
  LOOP
    SELECT registry.purge_claimed_at, registry.purged_at
      INTO claimed_at, deleted_at
    FROM derived_asset_registry registry
    WHERE registry.object_key = referenced_key
    FOR KEY SHARE;

    IF claimed_at IS NOT NULL OR deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'derived object % is unavailable for references', referenced_key
        USING ERRCODE = '55000';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_tombstoned_export_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.artifact IS NOT NULL AND NEW.artifact IS DISTINCT FROM OLD.artifact THEN
    PERFORM require_writable_project_owner(NEW.project_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS export_jobs_prevent_tombstoned_publication
  ON export_jobs;
CREATE TRIGGER export_jobs_prevent_tombstoned_publication
BEFORE UPDATE OF artifact ON export_jobs
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_export_publication();

CREATE OR REPLACE FUNCTION prevent_tombstoned_character_publication()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.document IS DISTINCT FROM OLD.document AND
     jsonb_path_exists(NEW.document, '$.**.objectKey') THEN
    PERFORM require_writable_project_owner(NEW.project_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS character_generations_prevent_tombstoned_publication
  ON character_generation_attempts;
CREATE TRIGGER character_generations_prevent_tombstoned_publication
BEFORE UPDATE OF document ON character_generation_attempts
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_character_publication();

DROP TRIGGER IF EXISTS character_rigs_prevent_tombstoned_publication
  ON character_rig_versions;
CREATE TRIGGER character_rigs_prevent_tombstoned_publication
BEFORE UPDATE OF document ON character_rig_versions
FOR EACH ROW EXECUTE FUNCTION prevent_tombstoned_character_publication();

DROP TRIGGER IF EXISTS layer_documents_lock_object_keys ON layer_documents;
CREATE TRIGGER layer_documents_lock_object_keys
BEFORE INSERT OR UPDATE OF document ON layer_documents
FOR EACH ROW EXECUTE FUNCTION lock_layer_document_object_keys();

DROP TRIGGER IF EXISTS layer_document_revisions_lock_object_keys
  ON layer_document_revisions;
CREATE TRIGGER layer_document_revisions_lock_object_keys
BEFORE INSERT OR UPDATE OF document ON layer_document_revisions
FOR EACH ROW EXECUTE FUNCTION lock_layer_document_object_keys();

CREATE OR REPLACE FUNCTION lock_character_reference_purge_claims()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  claimed_reference_id uuid;
BEGIN
  PERFORM require_writable_project_owner(NEW.project_id);
  SELECT reference.id INTO claimed_reference_id
  FROM character_reference_assets reference
  WHERE reference.bible_id = NEW.bible_id
    AND reference.purge_claimed_at IS NOT NULL
  ORDER BY reference.id
  LIMIT 1
  FOR KEY SHARE;

  IF claimed_reference_id IS NOT NULL THEN
    RAISE EXCEPTION 'character reference is already claimed for retention purge'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS character_models_lock_reference_claims
  ON character_identity_model_versions;
CREATE TRIGGER character_models_lock_reference_claims
BEFORE INSERT OR UPDATE OF bible_id, status ON character_identity_model_versions
FOR EACH ROW
WHEN (NEW.status IN ('draft', 'training', 'ready'))
EXECUTE FUNCTION lock_character_reference_purge_claims();
