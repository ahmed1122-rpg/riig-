# Object storage contract

MotionPrep uses one private S3-compatible bucket for uploaded sources, derived
raster layers, and generated export artifacts. PostgreSQL remains the source of
truth for ownership, hashes, job state, and retention timestamps; object keys
are never authorization credentials.

## Authentication and endpoint rules

- On AWS, leave `OBJECT_STORAGE_ACCESS_KEY`,
  `OBJECT_STORAGE_SECRET_KEY`, and `OBJECT_STORAGE_SESSION_TOKEN` blank. The
  AWS SDK default credential provider chain will use the task role, instance
  role, web identity, or another workload identity supplied by the platform.
- For a custom S3-compatible endpoint, provide the access and secret keys
  together. A temporary credential may also provide
  `OBJECT_STORAGE_SESSION_TOKEN`.
- Custom production endpoints must use HTTPS. Plain HTTP is accepted only for
  local development, such as the pinned MinIO container in `compose.yaml`.
- Use `OBJECT_STORAGE_FORCE_PATH_STYLE=false` for AWS S3 unless the deployment
  requires otherwise. Local MinIO uses `true`.

Grant the API and every worker the minimum bucket-scoped permissions needed to
check the bucket and to get, put, and delete objects under `sources/`,
`derived/`, `artifacts/`, and the narrow `projects/*/character-rig/*` path.
Do not grant a worker the broader `projects/*` prefix. Production startup only checks an existing
bucket; it never creates one. Development may create a missing bucket.

## Object layout and retention

| Prefix | Contents | Required retention |
|---|---|---|
| `sources/` | Validated image or PDF bytes for a source version | Retain while the source-version record exists |
| `derived/` | Immutable normalized raster layers and guided refinements | Register ownership before every write; retain while a current or revision `LayerDocument` references the key |
| `artifacts/` | Generated PSD, TIFF, ZIP, or text exports | Application access expires after 24 hours |
| `projects/<projectId>/character-rig/` | Private identity references, generated candidates, manifests, and rig PSDs | Retain only while referenced by the project; reference metadata carries a bounded expiry |

Do not apply a blanket time-based expiry to `sources/` or `derived/`; doing so
would break review and regeneration for live source versions. Project/source
deletion must delete the matching metadata and objects together when that
product workflow is introduced.

Configure a provider lifecycle rule for `artifacts/` that permanently expires
objects no later than two days after creation. The API independently refuses
downloads after the saved 24-hour expiry and attempts immediate deletion, so a
delayed lifecycle sweep cannot extend user access. If bucket versioning is
enabled, also expire non-current artifact versions according to the approved
recovery policy.

Monitor total bytes and object count separately for every prefix. Every
`derived/` write must first upsert `derived_asset_registry`; a registry failure
fails the object write closed. Tool and guidance keys include the operation ID
so a replay cannot overwrite an older referenced result. The retention sweep
considers a registered key only after a one-hour grace period, and only when it
is absent from both current `layer_documents` and retained
`layer_document_revisions`. It rechecks those references and the observed
registry timestamp before marking the cleanup complete. A prefix-wide expiry
is unsafe because live and historical documents reference these objects.

Character objects are never public URLs. API reads are ownership-checked and
the worker exchanges only scoped object metadata with the private inference
service. Account deletion collects object keys from Character references,
generation attempts, and rig versions before deleting project rows. Do not
enable Character Studio broadly until the scheduled reference-expiry sweep is
deployed and exercised against the selected object provider.

## Encryption and integrity

Production rejects `OBJECT_STORAGE_ENCRYPTION_MODE=none`.

- `sse-s3` requests `AES256` on each write and verifies the response with
  `HeadObject`.
- `bucket-default` relies on the provider policy but still verifies that
  server-side encryption was applied after each write.
- If encryption is missing or differs from explicit SSE-S3, the new object is
  deleted and the operation fails.

Writes reject a declared size that differs from the supplied bytes and request
an S3 SHA-256 checksum. MotionPrep also stores its own SHA-256 and size in
PostgreSQL. Every source read, derived-raster read, and artifact download
compares the retrieved bytes with that saved metadata. Source and raster
mismatches fail before the bytes reach a processor. Artifact downloads compare
the S3 metadata with PostgreSQL before response headers, then verify the byte
count and SHA-256 incrementally while streaming. If bytes change during an
active transfer, the stream and HTTP connection terminate instead of returning
an apparently successful corrupt file.

Object inspection returns `null` only for a provider-confirmed missing key.
An existing key whose required checksum metadata is absent raises an integrity
error, while provider authorization, timeout, and availability failures remain
retryable dependency errors. This distinction prevents an S3 outage from
incorrectly making a source terminal.

## Read and download memory policy

- Export downloads use Node streams from S3 through Fastify. Backpressure is
  preserved end to end; the artifact is not concatenated into one API buffer.
- Client disconnects abort the storage request and destroy the verification
  stream, avoiding continued S3 transfer after the consumer disappears.
- Processing libraries for PDF and raster transforms currently require random
  access to a complete input buffer. Those reads therefore remain buffered,
  but the object metadata is checked before transfer and each call is bounded
  to the exact size recorded for that source or raster asset.
- The compatibility `get()` storage API has a defensive 128 MiB ceiling when a
  caller does not supply a stricter limit. New processing code must pass the
  persisted expected size explicitly.

The metadata preflight is not a substitute for the streaming digest check: it
prevents known size/hash mismatches before headers, while the digest validates
the actual response body at end of stream.

## Transfer boundary

The current product limit is one file up to 30 MiB. Browser upload and artifact
download are authenticated API requests; v1 does not issue public or presigned
object URLs. This keeps ownership checks at the application boundary. If direct
multipart transfer is introduced later, it requires a separate ADR covering
short-lived signatures, content-length and checksum enforcement, CORS, abort
cleanup, and final ownership verification.

## Staging verification

Before release against the selected cloud provider:

1. Start the API and all workers using the same workload identity.
2. Confirm `/v1/health/ready` succeeds without static keys when workload
   identity is intended.
3. Upload a PNG and a scanned Arabic PDF, process both, and export PSD files.
4. Verify the source, derived, and artifact keys are private and encrypted.
5. Confirm an export is rejected after its saved expiry and that the provider
   lifecycle removes the object.
6. Interrupt a large artifact download and confirm the upstream S3 request is
   cancelled and API memory remains flat rather than scaling with file size.
7. Review provider audit logs for denied or unexpectedly broad object access.

With the staging variables loaded, run the non-destructive provider probe:

```bash
npm run verify:object-storage
```

The protected `staging-readiness` workflow first runs
`npm run verify:staging-dependencies --workspace @motionprep/api` to prove TLS
connections to PostgreSQL, Redis, and SMTP, then runs the object-store probe
above. It is a pre-release infrastructure check and does not replace the signed
recovery evidence required by `provider-readiness`.

It checks bucket access and required versioning, performs an encrypted checksum-protected write,
validates the downloaded bytes, deletes the probe, and confirms that it is no
longer readable. The command rejects plaintext endpoints and unencrypted
storage modes.

The repository's production-topology test uses PostgreSQL, Redis, versioned
MinIO, Mailpit, two API replicas, and all workers to exercise migrations,
distributed throttling, password-reset delivery, restarts, job leases, and a
real S3-compatible upload/process/export/download cycle. The protected
`provider-readiness` workflow remains a release gate because credentials,
encryption keys, bucket policy, and recovery snapshots are deployment-owned.

### GitHub provider-readiness identity

Choose exactly one authentication mode for the protected
`production-readiness` environment:

- **AWS OIDC (preferred):** set environment variables `AWS_ROLE_ARN` and
  `AWS_REGION`; leave `OBJECT_STORAGE_ACCESS_KEY` and
  `OBJECT_STORAGE_SECRET_KEY` unset. The workflow exchanges GitHub's OIDC
  token for short-lived credentials before running the probe.
- **Other S3-compatible providers:** leave `AWS_ROLE_ARN` unset and store both
  `OBJECT_STORAGE_ACCESS_KEY` and `OBJECT_STORAGE_SECRET_KEY` as environment
  secrets. Add `OBJECT_STORAGE_SESSION_TOKEN` only for temporary credentials.

The workflow rejects missing, half-configured, or ambiguous credentials. For
AWS, scope the IAM trust policy to the repository and the protected
environment. Because this job declares `environment: production-readiness`,
the expected GitHub OIDC subject is:

```text
repo:<OWNER>/<REPOSITORY>:environment:production-readiness
```

Grant the assumed role only the bucket/prefix operations required by this
document. Do not grant account-wide S3 administration.
