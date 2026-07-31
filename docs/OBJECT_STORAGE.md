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
`derived/`, and `artifacts/`. Production startup only checks an existing
bucket; it never creates one. Development may create a missing bucket.

## Object layout and retention

| Prefix | Contents | Required retention |
|---|---|---|
| `sources/` | Validated image or PDF bytes for a source version | Retain while the source-version record exists |
| `derived/` | Immutable normalized raster layers and guided refinements | Retain while a referencing `LayerDocument` exists |
| `artifacts/` | Generated PSD, TIFF, ZIP, or text exports | Application access expires after 24 hours |

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

Monitor total bytes and object count separately for all three prefixes. Review
unreferenced `derived/` objects before removal; a prefix-wide expiry is unsafe
because live layer documents reference those objects.

## Encryption and integrity

Production rejects `OBJECT_STORAGE_ENCRYPTION_MODE=none`.

- `sse-s3` requests `AES256` on each write and verifies the response with
  `HeadObject`.
- `bucket-default` relies on the provider policy but still verifies that
  server-side encryption was applied after each write.
- If encryption is missing or differs from explicit SSE-S3, the new object is
  deleted and the operation fails.

Writes request an S3 SHA-256 checksum. MotionPrep also stores its own SHA-256
and size in PostgreSQL. Every source read, derived-raster read, and artifact
download compares the retrieved bytes with that saved metadata. A mismatch
fails closed with an explicit integrity error; corrupted content is never sent
to a processor or user.

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
6. Review provider audit logs for denied or unexpectedly broad object access.

With the staging variables loaded, run the non-destructive provider probe:

```bash
npm run verify:object-storage
```

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
