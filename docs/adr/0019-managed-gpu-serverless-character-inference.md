# ADR 0019 — Managed GPU Serverless for Character inference

## Status

Superseded by ADR 0020 on 2026-08-28. This historical proof-of-concept must not
be used by the current product workflow.

## Context

Character identity training and multi-view generation are bursty GPU workloads.
Keeping an idle GPU inside the MotionPrep application deployment would increase
cost and operational scope, while scaling the API or PostgreSQL-backed worker on
CPU utilization would not represent GPU queue pressure. Scale-to-zero can reduce
idle cost, but cold starts and model loading can exceed an ordinary synchronous
HTTP request lifetime.

## Decision

Use an external, managed GPU Serverless endpoint behind the existing private
Character provider boundary. MotionPrep remains a CPU application: the API
persists idempotent jobs, `worker-character` submits them, and the GPU platform
owns model loading and replica scaling. GPU drivers and vendor SDKs do not enter
the API/runtime image.

The production provider protocol is `async-v1`:

1. Submit an identity or generation operation with an idempotency key.
2. Accept HTTP 202 plus a same-origin status URL.
3. Poll with bounded exponential delay and `Retry-After` support.
4. Stop on a validated terminal result, caller cancellation, or the 15-minute
   operation budget.

The first proof-of-concept policy is committed in
`config/gpu-serverless-readiness-policy.json`: scale to zero, zero minimum
replicas, at most two replicas, and target concurrency one per GPU replica.
Cold-start, queue, operation, retention, and customer-data-training declarations
must pass the live readiness probe before the release gate can be enabled.

`CHARACTER_RIG_ENABLED` remains `false`. Enabling it requires live provider
evidence tied to the exact release SHA, the existing Character benchmark, the
Adobe Character Animator Golden, rights/privacy approval, and an internal canary.

## Alternatives rejected for now

- A permanently running GPU: unjustified idle cost before measured demand.
- GPU containers inside the application Compose stack: expands driver, host,
  isolation, and patching responsibility without a selected production host.
- Autoscaling the API/worker replicas as a substitute for GPU autoscaling: the
  durable job queue and provider queue are the correct demand signals.
- Selecting a vendor in source code: account, region, data-processing terms,
  model availability, and measured cost are still external decisions.

## Consequences

Cold starts become an explicit user-visible state instead of an HTTP timeout.
The provider must implement the capability and conformance endpoints documented
in `docs/CHARACTER_GPU_SERVERLESS.md`. The provider remains replaceable, and the
application can retain `direct-v1` for local compatibility, but a production GPU
Serverless release must pass `async-v1` readiness.

## Rollback

Set `CHARACTER_RIG_ENABLED=false`, restart the API, and gracefully stop
`worker-character`. Do not delete queued jobs or approved artifacts. The external
GPU endpoint may then be scaled to zero or removed using its own account-owned
rollback procedure.
