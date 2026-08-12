# ADR 0018 — Identity-locked character rig pipeline

## Status

Accepted for incremental implementation. The external inference provider and the
base model remain an evaluation decision; neither is selected by this ADR.

## Context

MotionPrep can currently split raster images into alpha-connected components and
export a flat RGB/8-bit PSD. That is useful for simple assets, but it cannot
reliably preserve a character's identity across new camera views, regenerate one
body part without changing the rest of the character, or produce the semantic
hierarchy expected by a professional character-rig workflow.

A single prompt plus a single source image is not an authoritative identity
specification. It leaves facial geometry, proportions, palette, materials, and
occluded details underconstrained. Treating such output as production-ready would
make drift difficult to detect and impossible to audit.

The private PSD supplied during discovery is a useful semantic reference: it is
1500×1500 RGB/16-bit and contains groups for frontal and left-quarter views. It
does not contain all five canonical views and cannot be a release Golden. The
binary is not stored in this repository; only its fingerprint and structural
measurements are recorded.

## Decision

Introduce a `character-rig` bounded context with this explicit workflow:

1. Create an immutable Character Bible describing identity, proportions, palette,
   materials, naming, and negative constraints.
2. Build a Canonical Reference Pack from user-authorized images and record
   provenance for every asset.
3. Train or register an immutable Identity Model Version behind a provider
   interface. Provider-specific identifiers never become domain identifiers.
4. Generate controlled canonical views and parts from the Bible, identity model,
   pose/depth controls, seed, and versioned generation parameters.
5. Require automated comparison and explicit human review before generated views
   or repaired parts can be promoted.
6. Compile approved assets into a versioned rig tree, then export a hierarchical
   RGB/8-bit PSD plus a machine-readable manifest.

The five MVP head views are `frontal`, `left-quarter`, `left-profile`,
`right-quarter`, and `right-profile`. Full-body frontal and the required facial
and body parts are also in scope. Visemes are optional for the first release.

`LayerDocument` remains the general image-editing document and an export/adoption
boundary. Character identity, references, model versions, generation attempts,
review decisions, and rig semantics are stored in the new bounded context rather
than being encoded in layer names or source-version history.

The inference runtime is asynchronous. API routes create idempotent jobs; a
worker calls a private provider interface; generated artifacts are quarantined
until validation and review succeed. A 3D proxy may later provide stronger pose
control, but it is not required for the MVP and must not block the 2D pipeline.

## Quality gates

Quality thresholds are versioned in
`config/character-rig-quality-thresholds.json`. A candidate cannot be approved if
it has a severe rig defect, misses a required template node, exceeds the declared
identity/proportion/palette tolerances, or changes pixels outside a part-repair
mask. Automated scores assist review; they do not replace the named human
reviewer and decision record.

The first release target is RGB/8-bit because the current `ag-psd` adapter and
licensed Adobe Golden evidence support that format. Input references may be
16-bit, but generated rig assets are normalized at the export boundary. PSB,
CMYK, and a claim of lossless 16-bit output are non-goals for this decision.

## Security, privacy, and operations

- Every reference requires an ownership/consent classification and a retention
  deadline. Unknown rights fail closed.
- Private reference and model artifacts use project-scoped object keys and the
  existing authenticated object-storage boundary. Logs contain opaque IDs,
  hashes, and metrics, never source pixels or prompts containing private paths.
- Identity models and generated artifacts are covered by retention cleanup,
  deletion audit, storage quotas, and per-project authorization before launch.
- Provider calls have timeouts, bounded retries, cost counters, and circuit
  breaking. A feature flag and worker kill switch disable new work without
  corrupting approved rigs.
- Immutable inputs and idempotency keys make retries reproducible. A failed job
  never replaces an approved version.

## Verification

- Unit tests validate contracts, state transitions, quality thresholds,
  idempotency, mask isolation, and recursive rig compilation.
- Integration tests cover API authorization, job leasing, provider replay,
  artifact adoption, retention, and revision conflicts.
- A repository-safe benchmark validates the private sample's metadata when the
  authorized file is supplied locally and validates the manifest in CI without
  requiring the binary.
- Release validation requires a synthetic/licensed five-view Golden opened in
  Photoshop and Adobe Character Animator, plus a 30-second animation smoke test.

## Consequences

This adds durable character-specific records, worker capacity, object-storage
classes, review UI, and operational cost. In return, identity drift and model
outputs become measurable, reviewable, reproducible, and reversible. The
provider boundary keeps model choice replaceable after evidence-based evaluation.

## Rollback

Disable character-rig capability advertisement and stop the character worker.
Existing approved artifacts remain readable and exportable. No migration changes
the meaning of existing `LayerDocument` or `SourceVersion` records, so the
current image workflow continues independently.
