# ADR 0020 — Source-preserving Character Rig

## Status

Accepted on 2026-08-28. Supersedes ADR 0018 for the product workflow.

## Context

The product must prepare the user's uploaded character image, not generate a
replacement character. Generated views, identity models, and invented parts can
change the character, add licensing dependencies, and make export differ from
the upload.

## Decision

Character Studio operates in `source-preserving` mode:

1. The current upload is copied to an immutable project-scoped reference tied
   to its `sourceVersionId` and SHA-256.
2. PSD compilation consumes only raster assets from the matching
   `LayerDocument` revision.
3. The worker reconstructs the visible RGBA canvas and compares it with the
   decoded upload byte-for-byte at pixel level before writing the PSD.
4. Any mismatch, missing source, unsupported text layer, invalid bounds, or
   integrity failure stops compilation. No unverified PSD is stored.
5. Identity training and image-generation endpoints return
   `CHARACTER_GENERATION_DISABLED_SOURCE_ONLY`.
6. Occluded or absent parts are never invented. Animation-ready semantic parts
   require source layers or explicit manual preparation.

The manifest records `sourceIntegrity.mode=pixel-exact`, the source SHA-256,
source version, and successful verification.

## Consequences

- The exported composite is the uploaded image, enforced by a pixel-identity
  invariant.
- RunPod, InsightFace, diffusion weights, and model licenses are not required.
- A flat opaque image remains an honest single raster layer until a user or a
  deterministic source-only tool separates it. The application does not claim
  that a flat image is already a fully animated Adobe Character Animator puppet.
- Provider, model-evidence, and GPU deployment code are removed from the active
  repository surface; historical database columns remain only for migration
  compatibility.

## Rollback

Set `CHARACTER_RIG_ENABLED=false` to stop new operations. Do not switch
to external inference without a new product decision, legal approval, and an
ADR that explicitly replaces this decision.
