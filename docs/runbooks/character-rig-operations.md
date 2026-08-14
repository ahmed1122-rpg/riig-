# Character Studio operations

Character Studio is fail-closed. Keep `CHARACTER_RIG_ENABLED=false` unless the
release has a passing private-provider benchmark, a signed Adobe Character
Animator Golden, and a running `worker-character` heartbeat.

The feature accepts image projects only. PDF/book projects are excluded by the
public capability contract, the workspace tool registry, the dialog boundary,
and the authorization guard shared by every Character Rig HTTP operation.

## Enablement

1. Store `CHARACTER_INFERENCE_API_KEY` in the deployment secret store. Never
   place it in source control or logs.
2. Configure an HTTPS `CHARACTER_INFERENCE_URL`. Plain HTTP is accepted only
   for explicitly enabled localhost development. A private path prefix is
   preserved with or without a trailing slash. Embedded credentials, query
   strings, and fragments are invalid configuration.
3. Start the optional Compose profile with
   `docker compose --profile character-rig up -d worker-character`.
4. Confirm `motionprep_worker_up{worker_type="character"} == 1`, queue age is
   below five minutes, and the sealed Character Rig benchmark passes.
5. Set `CHARACTER_RIG_ENABLED=true` on the API and restart only the API.

## Safe disablement

Set `CHARACTER_RIG_ENABLED=false` and restart the API. Existing jobs remain in
durable storage but no new user operations can be submitted. Stop the worker
gracefully with `SIGTERM`: in-flight provider requests receive cancellation,
the worker drains for `CHARACTER_DRAIN_TIMEOUT_MS` (30 seconds by default), and
any claim still active is fenced and requeued without consuming a retry. Keep
the platform stop grace period above this timeout.

## Incident response

- Provider unavailable or rate-limited: disable the feature, retain queued
  attempts, and investigate without replaying with new idempotency keys.
- Identity drift: reject the attempt, preserve its quality report and review,
  retire the affected identity model version, and rerun the holdout benchmark.
- Artifact integrity failure: do not expose or compile the artifact. Compare the
  object-store SHA-256 with the recorded artifact and follow the storage
  recovery procedure.
- PSD Golden failure: block export enablement. Generated PSDs remain
  `needs-review`; do not relabel them as Adobe-compatible.

## Recovery and privacy

Reference objects are copied under the project-scoped `character-rig` prefix.
Deleting a project cascades its database records; object cleanup must be
included in the retention task before broad release. Provider retention must be
zero or contractually bounded, and provider logs must never contain image bytes,
Bible text, API keys, or signed object URLs.
