# Layer review and export API

All routes require the authenticated session cookie and enforce project
ownership on the server.

## Read the current document

```http
GET /v1/projects/{projectId}/layer-document?sourceVersionId={uuid}
```

The response `data` is the current `LayerDocument`, including its `revision`.
Prepared image layers include immutable raster-asset metadata (content type,
size, and SHA-256).

## Read a raster layer asset

```http
GET /v1/projects/{projectId}/layers/{layerId}/asset?sourceVersionId={uuid}
```

This binary endpoint repeats authentication and ownership checks, verifies the
stored bytes against the document metadata, and returns `image/png`. Missing
or cross-account assets return 404; an integrity mismatch returns 500 and is
not streamed.

## Save reviewed layer fields

```http
PATCH /v1/projects/{projectId}/layer-document
Content-Type: application/json

{
  "sourceVersionId": "00000000-0000-0000-0000-000000000000",
  "baseRevision": 1,
  "layers": [
    {
      "id": "layer-id",
      "name": "+reviewed_name",
      "visible": true,
      "locked": false,
      "opacity": 0.75,
      "zIndex": 4,
      "readingOrder": 2
    }
  ]
}
```

Only the editable fields above are accepted. `readingOrder` is optional for
image layers. Names must begin with `+`, opacity is in the inclusive range
`0..1`, duplicate or unknown layer IDs are rejected, and no more than 1,000
layer changes are accepted in one request. Fixed PDF backgrounds cannot be
renamed, hidden, unlocked, or reordered.
The server validates the complete resulting document before atomically saving
revision `baseRevision + 1`.

Important errors:

- `400 VALIDATION_FAILED`: malformed boundary payload.
- `400 INVALID_LAYER_UPDATE`: an unknown/duplicate layer or invalid resulting
  document.
- `404 PROJECT_NOT_FOUND` or `DOCUMENT_NOT_FOUND`.
- `409 DOCUMENT_REVISION_CONFLICT`: another review saved first. Reload the
  current document and deliberately reapply the intended changes.

## Create and download an export

```http
POST /v1/exports
X-Idempotency-Key: stable-key-at-least-8-characters
```

Image projects accept `psd`, `layered-tiff`, `png-layers-json`, and
`transparent-pngs`. PDF projects accept `psd`, `png-layers-json`, `txt`, `csv`,
and `json`. PDF PSD supports `full-document`, `per-page`, and `selected-page`
scopes. Unsupported formats fail explicitly; they are not silently relabeled.

```http
GET /v1/exports/{exportId}/download
```

The download route verifies authentication and ownership again before
returning the stored artifact.
