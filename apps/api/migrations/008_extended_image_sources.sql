ALTER TABLE upload_sessions
  DROP CONSTRAINT IF EXISTS upload_sessions_content_type_check;

ALTER TABLE upload_sessions
  ADD CONSTRAINT upload_sessions_content_type_check
  CHECK (
    content_type IN (
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/avif',
      'image/tiff',
      'image/bmp',
      'application/pdf'
    )
  );
