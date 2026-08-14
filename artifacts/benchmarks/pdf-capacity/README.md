# PDF capacity evidence — 2026-08-13

This directory retains the production-shaped local capacity result for the
30 MiB upload policy. The measured source was a valid one-page PDF with an
incompressible embedded payload:

- size: 31,416,448 bytes (29.961 MiB);
- source SHA-256: `001c519e80e5132a6eda8048fab0fafd1a5c6744d90eae8bade6639ed501321a`;
- concurrency: 20 complete upload/process/review/export/download journeys;
- account pool: 8 authenticated accounts, keeping the test below the separate
  registration-abuse limit while preserving 20 concurrent workflows;
- polling interval: 5 seconds, below the shared 300 requests/minute API limit;
- result: 20/20 successful, 0% error rate;
- workflow p95: 28,124 ms;
- upload p95: 12,257 ms;
- API RSS peak growth: 384,753,664 bytes (limit 536,870,912);
- worker RSS peak growth: 224,464,896 bytes (limit 268,435,456);
- peak queue depth/age: 13 jobs / 5.11 seconds;
- final queue depth: 0.

The same run rebuilt the runtime image, started PostgreSQL, Redis, versioned
MinIO, Mailpit, two API replicas and all workers, and passed outage detection
and recovery for Redis, MinIO, Mailpit and PostgreSQL before the load phase.
All containers, volumes, networks and allocated loopback ports were removed by
the runner afterward.

The retained JSON is the machine-readable source of truth. It is local
candidate evidence, not release-bound managed-staging evidence: its release
identity is intentionally the integration placeholder until an immutable
commit/tag and signed image digests exist.
