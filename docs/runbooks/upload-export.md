# Runbook — Upload and export pipeline

## Alerts

- Active upload age exceeds 15 minutes.
- Upload verification failure rate exceeds 5% for 10 minutes.
- Export queue wait p95 exceeds the plan SLO.
- Export retry rate exceeds 2% or `lease_lost` appears.
- Export verification failure rate exceeds 2%.
- Repeated artifact checksum mismatch.

## First checks

1. Filter structured logs by `project_id`, then `source_version_id`.
2. Inspect upload/export state transitions and the last valid checkpoint.
3. Check Object Storage availability, workload-identity credentials, the
   artifact `expiresAt`, and the bucket lifecycle. v1 does not issue signed
   object URLs.
4. Check PostgreSQL job attempts, `next_attempt_at`, lease owner, and lease
   expiry. Redis is not the processing/export queue.
5. For export failures, run the structural verifier against the stored `LayerDocument`.
6. For PSD failures, confirm the source decodes to RGBA, dimensions are at most
   30,000px per axis, and the artifact begins with `8BPS`.
7. For review-save failures, compare the submitted `baseRevision` with the
   current `LayerDocument.revision`; HTTP 409 means the reviewer is editing a
   stale document and must reload before retrying.
8. For a missing raster layer, compare its `rasterAsset` size and SHA-256 with
   the object at the referenced key. Never export a partially matching asset
   set.

## Safe mitigation

- Pause dispatching new exports while preserving queued jobs.
- Keep ready source objects under `sources/` unchanged until verification
  resumes. Do not apply a temporary prefix-wide expiry.
- Retry only through the same idempotency key.
- Do not manually mark a failed artifact as ready.
- Disable `psd` in the image format allow-list if a compatibility regression is
  confirmed; keep `png-layers-json` available as the reversible fallback.

## Recovery

- Upload: the current API accepts one request up to 30 MiB and does not use
  multipart transfer. If the session is invalid, cancel it and create a new
  source version.
- Export: let the expired lease be reclaimed, then replay from the last
  approved `LayerDocument`; never rerun AI/OCR unless that version is missing.
- Checksum mismatch: quarantine the artifact, alert, and regenerate with the same exporter version before considering a rollback.
- Adobe compatibility regression: preserve the failing artifact and source as a
  Golden fixture, roll back the exporter version, and do not relabel a TIFF or
  flat image as a layered substitute.
- Review revision conflict: do not overwrite the newer document. Reload it,
  reapply the intended field-level edits, and submit against its current
  revision.
- Derived raster corruption: quarantine the affected source version, rerun the
  same processing job, and delete old derived objects only after the
  replacement document is committed.
