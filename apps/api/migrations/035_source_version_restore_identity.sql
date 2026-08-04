ALTER TABLE source_version_restore_events
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS originating_request_id text,
  ADD COLUMN IF NOT EXISTS operation_id uuid;

UPDATE source_version_restore_events
SET idempotency_key = COALESCE(idempotency_key, request_id),
    originating_request_id = COALESCE(originating_request_id, request_id),
    operation_id = COALESCE(operation_id, id);

CREATE OR REPLACE FUNCTION sync_source_version_restore_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.idempotency_key := COALESCE(NEW.idempotency_key, NEW.request_id);
    NEW.request_id := COALESCE(NEW.request_id, NEW.idempotency_key);
  ELSIF NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    AND NEW.request_id IS NOT DISTINCT FROM OLD.request_id THEN
    NEW.request_id := NEW.idempotency_key;
  ELSIF NEW.request_id IS DISTINCT FROM OLD.request_id
    AND NEW.idempotency_key IS NOT DISTINCT FROM OLD.idempotency_key THEN
    NEW.idempotency_key := NEW.request_id;
  END IF;

  NEW.originating_request_id := COALESCE(
    NEW.originating_request_id,
    NEW.request_id
  );
  NEW.operation_id := COALESCE(NEW.operation_id, NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS source_version_restore_events_sync_identity
  ON source_version_restore_events;
CREATE TRIGGER source_version_restore_events_sync_identity
BEFORE INSERT OR UPDATE OF
  request_id, idempotency_key, originating_request_id, operation_id
ON source_version_restore_events
FOR EACH ROW EXECUTE FUNCTION sync_source_version_restore_identity();

ALTER TABLE source_version_restore_events
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN originating_request_id SET NOT NULL,
  ALTER COLUMN operation_id SET NOT NULL;

ALTER TABLE source_version_restore_events
  ADD CONSTRAINT source_version_restore_events_idempotency_key_length
    CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  ADD CONSTRAINT source_version_restore_events_request_identity_compatible
    CHECK (request_id = idempotency_key),
  ADD CONSTRAINT source_version_restore_events_originating_request_length
    CHECK (char_length(originating_request_id) BETWEEN 1 AND 128);

CREATE UNIQUE INDEX IF NOT EXISTS
  source_version_restore_events_actor_idempotency_idx
  ON source_version_restore_events(actor_user_id, idempotency_key);

CREATE UNIQUE INDEX IF NOT EXISTS
  source_version_restore_events_operation_idx
  ON source_version_restore_events(operation_id);
