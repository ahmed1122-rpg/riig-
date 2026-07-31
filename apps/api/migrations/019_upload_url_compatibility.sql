-- Compatibility repair for databases that applied the original 009 migration,
-- which renamed demo_upload_url directly. Keep both names through at least one
-- complete release/rollback window so N and N+1 can share the expanded schema.
ALTER TABLE upload_sessions
  ADD COLUMN IF NOT EXISTS demo_upload_url text;

ALTER TABLE upload_sessions
  ADD COLUMN IF NOT EXISTS upload_url text;

UPDATE upload_sessions
SET
  demo_upload_url = COALESCE(demo_upload_url, upload_url),
  upload_url = COALESCE(upload_url, demo_upload_url)
WHERE demo_upload_url IS NULL OR upload_url IS NULL;

CREATE OR REPLACE FUNCTION sync_upload_session_urls()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.upload_url := COALESCE(NEW.upload_url, NEW.demo_upload_url);
    NEW.demo_upload_url := COALESCE(NEW.demo_upload_url, NEW.upload_url);
  ELSIF NEW.upload_url IS DISTINCT FROM OLD.upload_url
    AND NEW.demo_upload_url IS NOT DISTINCT FROM OLD.demo_upload_url THEN
    NEW.demo_upload_url := NEW.upload_url;
  ELSIF NEW.demo_upload_url IS DISTINCT FROM OLD.demo_upload_url
    AND NEW.upload_url IS NOT DISTINCT FROM OLD.upload_url THEN
    NEW.upload_url := NEW.demo_upload_url;
  END IF;
  IF NEW.upload_url IS NULL OR NEW.demo_upload_url IS NULL THEN
    RAISE EXCEPTION 'upload URL columns must remain populated';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS upload_sessions_sync_urls ON upload_sessions;
CREATE TRIGGER upload_sessions_sync_urls
BEFORE INSERT OR UPDATE OF upload_url, demo_upload_url ON upload_sessions
FOR EACH ROW EXECUTE FUNCTION sync_upload_session_urls();

ALTER TABLE upload_sessions
  ALTER COLUMN demo_upload_url SET NOT NULL,
  ALTER COLUMN upload_url SET NOT NULL;
