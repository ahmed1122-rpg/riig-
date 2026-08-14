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

The API does not accumulate a production upload in one in-memory `Buffer`.
It stages the bounded request as a unique temporary file while calculating the
SHA-256 digest and inspecting the signature, then streams that file to object
storage with an explicit content length and checksum. The temporary file and
its concurrency permit are released on success, rejection, route failure, and
request abort. `UPLOAD_BODY_CONCURRENCY` defaults to 3 and is capped at 8; the
runtime temporary volume must therefore reserve at least the configured
concurrency multiplied by 30 MiB, plus operating-system and processing
headroom. Production monitoring must alert on temporary-volume exhaustion.

The S3 adapter sends the precomputed SHA-256 as the provider checksum and
object metadata, then verifies size, content type, digest, and encryption with
a metadata read before the upload can be published. The memory adapter retains
buffering only as a deterministic development/test implementation.

`MAX_UPLOAD_BYTES` controls the shared request ceiling and may only reduce the
30 MiB product maximum. `MAX_IMAGE_UPLOAD_BYTES` may independently reduce the
image ceiling below that shared maximum.
