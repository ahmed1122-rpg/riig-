# ADR 0017: Optional distributed tracing across durable jobs

## Status

Accepted on 2026-08-02.

## Context

Request IDs and persisted correlation IDs support individual log searches, but
they do not reconstruct causal timing across the API, PostgreSQL-backed queues,
and three worker processes. Tracing must also remain optional for small local
deployments and must not require a collector to start the product.

## Decision

- Use OpenTelemetry with the OTLP/HTTP exporter only when
  `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` is configured.
- Reject plaintext production collector endpoints and credentials embedded in
  endpoint URLs. Collector authentication is supplied through the deployment
  secret `OTEL_EXPORTER_OTLP_HEADERS`.
- Create API server spans and validate W3C `traceparent`/`tracestate` values.
- Persist that context on processing and export jobs, then create worker
  consumer spans using the persisted parent.
- Keep `correlation_id` as the stable support identifier in API responses and
  logs; distributed tracing complements rather than replaces it.
- Use environment-controlled parent-based sampling so sampling can be tuned
  without a release.

## Consequences

Operators can follow upload-adjacent processing and export work across process
boundaries when a collector exists. With no exporter endpoint, no SDK is
started and the system behaves as before, while valid inbound context can still
be retained with a durable job.
