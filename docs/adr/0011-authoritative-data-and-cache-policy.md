# ADR 0011: Authoritative data and cache policy

## Context

The review proposed Redis caches for subscriptions and layer documents, cached
presigned URLs, and a frontend server-state library. Those changes introduce
staleness and invalidation paths around quota enforcement, collaborative edits,
and expiring credentials without evidence that database reads are an SLO
bottleneck.

## Decision

- Keep subscription usage and limits authoritative in PostgreSQL. Quota
  reservations continue to use transactions and row locks.
- Do not cache mutable layer documents outside their current repository until
  revision-keyed reads and invalidation are specified.
- Generate presigned URLs on demand; do not reuse them across authorization
  decisions.
- Continue browser caching only for immutable, version-addressed raster assets.
- Add Redis or frontend server-state caching only after traces show a material
  latency or database-load problem and the change defines keys, TTL, invalidation,
  authorization boundaries, hit-rate metrics, and a disable switch.

## Consequences

The initial system performs more authoritative reads but has fewer stale-state
failure modes. A future cache change is still available and reversible, but it
must include performance evidence and correctness tests rather than being added
solely because a caching library is absent.
