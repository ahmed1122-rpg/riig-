# Character GPU Serverless contract and readiness

## Current state

The application-side integration is implemented, tested, and disabled by
default. No external GPU resource is created by this repository. A platform
owner must still select a managed provider, model, region, private networking,
and data-processing terms, then implement this provider-neutral contract.

```text
API -> durable PostgreSQL job -> worker-character -> private HTTPS async provider
                                                    -> managed GPU autoscaler
provider -> project-scoped object storage -> integrity validation -> review
```

The GPU provider scales on its own pending-operation/concurrency signal. The API
and `worker-character` must not be scaled merely to compensate for GPU cold
starts. `worker-character` concurrency remains one for the initial canary.

## Required HTTP contract

All routes are below `CHARACTER_INFERENCE_URL`. Every operation request carries
`Authorization: Bearer ...`, `X-Idempotency-Key`, and
`X-MotionPrep-Protocol-Version: 1`. Provider responses are JSON and bounded by
the client; redirects, cross-origin status URLs, embedded credentials, query
strings, and fragments are rejected.

`POST v1/identity-models` and `POST v1/generations` return HTTP 202:

```json
{
  "operationId": "opaque-operation-id",
  "statusUrl": "v1/operations/opaque-operation-id",
  "retryAfterMilliseconds": 1000
}
```

Polling returns HTTP 202 with `queued` or `running`, or HTTP 200 with exactly one
terminal state:

```json
{ "status": "running", "retryAfterMilliseconds": 2000 }
```

```json
{ "status": "succeeded", "result": {} }
```

```json
{ "status": "failed", "errorCode": "CAPACITY_EXHAUSTED" }
```

Allowed terminal codes are `CAPACITY_EXHAUSTED`, `INPUT_REJECTED`,
`MODEL_REJECTED`, `OPERATION_EXPIRED`, and `PROVIDER_INTERNAL`. Repeating a
submission with the same idempotency key must return the same logical operation
and must not duplicate GPU work or cost.

## Readiness endpoints

`GET v1/capabilities` must return schema version 1 and declarations that satisfy
`config/gpu-serverless-readiness-policy.json`:

```json
{
  "schemaVersion": 1,
  "protocols": ["async-v1"],
  "autoscaling": {
    "scaleToZero": true,
    "minReplicas": 0,
    "maxReplicas": 2,
    "targetConcurrency": 1
  },
  "operationBudgets": {
    "coldStartMilliseconds": 180000,
    "queueMilliseconds": 300000,
    "operationMilliseconds": 900000
  },
  "privacy": {
    "inputRetentionSeconds": 0,
    "outputRetentionSeconds": 0,
    "customerDataTraining": false
  }
}
```

`POST v1/conformance/operations` accepts a control-plane-only probe containing
no user data. It uses the same 202/polling contract and terminates with
`{ "status": "succeeded", "probeId": "..." }`. It must be cheap, ephemeral,
idempotent, and safe to run from a protected release workflow.

## Initial policy and measurements

The committed ceilings are safety limits for the proof of concept, not claims
about observed performance:

| Control | Initial value |
| --- | ---: |
| Minimum replicas | 0 |
| Maximum replicas | 2 |
| Target concurrent operations per replica | 1 |
| Declared cold-start budget | 180 seconds |
| Queue budget | 300 seconds |
| End-to-end operation budget | 900 seconds |
| Input/output provider retention | at most 3600 seconds |
| Training on customer data | disabled |

Before an internal canary, collect warm and cold latency, queue age, success and
retry rates, GPU-seconds per successful asset, peak memory, and cost per accepted
rig using synthetic or licensed image fixtures. Tighten the policy only from
observed evidence; increasing replicas or retention requires review.

## Release gate

Configure the protected `production-readiness` GitHub environment:

- variable `CHARACTER_RIG_ENABLED=false` while no provider is approved;
- variables `CHARACTER_INFERENCE_URL` and the exact release coordinates;
- secret `CHARACTER_INFERENCE_API_KEY`;
- provider egress allowlist and private object-storage permissions.

Run `npm run verify:character-provider`. With the feature disabled it emits a
fail-closed disabled record. With the feature enabled it verifies HTTPS,
capabilities, the scaling/privacy policy, async submission, same-origin polling,
idempotency headers, and terminal success. The redacted evidence is bound to the
release artifact and rechecked during stable promotion.

Passing this control-plane probe is necessary but not sufficient. Do not enable
the feature until the model benchmark, licensed Golden, deletion/retention test,
representative load and cold-start test, privacy/legal review, and rollback
canary all pass against the same release.
