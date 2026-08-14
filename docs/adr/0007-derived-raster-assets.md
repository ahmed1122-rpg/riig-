# ADR 0007: Persist derived raster assets beside the layer document

## Status

Accepted.

## Context

The original image slice stored one `+source` layer and made exporters read the
uploaded object directly. That cannot represent multiple independently
movable image layers, and review UI would have no trustworthy per-layer
preview.

The current deployment assumption is a modular monolith with an S3-compatible
private bucket, PostgreSQL for metadata, the then-current 30MB upload, and at most 15
image layers. Semantic AI model hosting is not yet available in every
environment.

## Decision

- Image preparation always emits normalized PNG raster assets and records an
  immutable reference (private object key, content type, size, SHA-256) on the
  corresponding `LayerNode`.
- Transparent inputs are split by 8-connected Alpha components. Cropped assets
  retain exact source pixels and document-coordinate bounds.
- At most 15 layers are emitted. If more components exist, the 14 largest stay
  independent and every remaining component is retained in one explicit
  `+تفاصيل_مجمعة` review layer.
- Opaque, connected, or resource-heavy inputs fall back to one honest
  `+source` layer. This is not labeled semantic or AI segmentation.
- Decoded image work is capped at 25 million pixels; connected-component work
  is capped at 16,777,216 pixels to bound memory.
- The API and exporters verify the stored size and SHA-256 before returning or
  consuming an asset.
- The worker writes derived objects before committing the document and removes
  them on a handled commit failure. Deterministic prefixes plus bucket
  lifecycle cleanup cover process-crash orphans.

## Trade-offs

This immediately supports real multi-layer PSD/PNG export for transparent
artwork without adding a heavyweight model runtime. It does not infer semantic
body parts from one connected or opaque image; a future AI adapter can emit the
same `PreparedRasterAsset` contract without changing storage, review, or
export code.

Cropping reduces object size and PSD decode work, while the web preview uses
document bounds in an SVG coordinate system to preserve alignment.

## Security and privacy

Object keys are not authorization credentials. The bucket remains private,
asset reads require an authenticated project owner, and cross-account requests
return 404. Pixel bytes and object keys are not written to logs.

## Rollback

Disable alpha-component preparation and emit one normalized source asset.
Existing multi-layer documents remain exportable because exporters consume the
stored references rather than the segmentation implementation.
