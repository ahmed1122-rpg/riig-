# Character Studio operations

Character Studio is fail-closed and source-preserving. It compiles only the
current upload's raster layers and verifies that their visible RGBA composite
matches the upload pixel-for-pixel. It does not require a GPU model, model
weights, RunPod, or an inference-provider license.

The feature accepts image projects only. PDF/book projects are excluded by the
public capability contract, the workspace tool registry, the dialog boundary,
and the authorization guard shared by every Character Rig HTTP operation.

## Enablement

1. Confirm the source upload, processed `LayerDocument`, and object storage are
   available and pass their existing integrity checks.
2. Start the optional Compose profile with
   `docker compose --profile character-rig up -d worker-character`.
3. Confirm `motionprep_worker_up{worker_type="character"} == 1`, queue age is
   below five minutes, and the pixel-identity tests pass.
4. Set `CHARACTER_RIG_ENABLED=true` on the API and restart only the API.

## Safe disablement

Set `CHARACTER_RIG_ENABLED=false` and restart the API. Existing jobs remain in
durable storage but no new user operations can be submitted. Stop the worker
gracefully with `SIGTERM`: in-flight compilation receives cancellation,
the worker drains for `CHARACTER_DRAIN_TIMEOUT_MS` (30 seconds by default), and
any claim still active is fenced and requeued without consuming a retry. Keep
the platform stop grace period above this timeout.

## Incident response

- `CHARACTER_SOURCE_COMPOSITE_MISMATCH`: do not export. Restore source layer
  visibility, opacity, bounds, and ordering until the composite is exact.
- `CHARACTER_GENERATION_DISABLED_SOURCE_ONLY`: expected when a legacy client
  tries to train or generate. Keep the retired operation disabled.
- Artifact integrity failure: do not expose or compile the artifact. Compare the
  object-store SHA-256 with the recorded artifact and follow the storage
  recovery procedure.
- PSD Golden failure: block export enablement. Generated PSDs remain
  `needs-review`; do not relabel them as Adobe-compatible.

## Recovery and privacy

Reference objects are copied under the project-scoped `character-rig` prefix.
Deleting a project cascades its database records; object cleanup must be
included in the retention task before broad release. The source-only worker
makes no inference-provider request. Logs must never
contain image bytes, Bible text, storage credentials, or signed object URLs.
