# Upload and compression policy

- One source file is accepted per upload operation.
- Images are limited to **30 MiB**.
- PDF files are limited to **30 MiB**.
- The browser does not recompress an uploaded PDF. The immutable original is
  retained so text, vectors, fonts, signatures, and evidence hashes are not
  silently changed.
- Preview assets may be derived asynchronously without replacing the original.
- Compression belongs at export time: PNG uses maximum lossless compression,
  layered TIFF uses LZW, and export archives are compressed asynchronously.
  Any future lossy preset must be an explicit user choice with an estimated
  output size and must never overwrite the source.

The reverse proxy accepts a 30 MiB request body. The API applies the same
product ceiling before creating an upload session and verifies
the actual file signature, declared size, stored size, and SHA-256 digest.

`MAX_UPLOAD_BYTES` controls the shared request ceiling and may only reduce the
30 MiB product maximum. `MAX_IMAGE_UPLOAD_BYTES` may independently reduce the
image ceiling below that shared maximum.
