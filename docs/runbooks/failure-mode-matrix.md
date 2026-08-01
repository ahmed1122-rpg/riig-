# Failure mode and recovery matrix

This matrix defines the required behavior for production-critical workflows.
The automated dependency cases run against the production-shaped Docker
topology with `npm run test:faults:topology`. Provider rows remain staging
gates because local emulators cannot prove managed-service behavior.

| Workflow | Injected failure | Required invariant | Automated evidence |
|---|---|---|---|
| API readiness | PostgreSQL unavailable | `/v1/health/ready` returns 503 and returns to 200 after recovery | Docker fault gate |
| Distributed throttling | Redis unavailable | readiness fails closed; no silent per-process fallback | Docker fault gate |
| Upload/export storage | S3 unavailable | readiness fails closed; published database state is not fabricated | Docker fault gate plus atomic upload integration tests |
| Password reset | SMTP unavailable | readiness reports degradation; durable outbox retains bounded retry state | Docker fault gate plus outbox tests |
| Processing | media worker restart | active lease is drained or reclaimed and work remains replay-safe | production topology gate |
| Export | export worker stopped after enqueue | job stays durable and completes once the worker returns | production topology gate |
| Upload finalization | database command fails after object write | transaction rolls back; reconciliation/replay publishes once | PostgreSQL/S3 integration test |
| Billing webhook | duplicate signed event across API replicas | subscription/audit state changes once | production topology gate |
| Managed database | provider failover | no lost committed project state; RPO/RTO remain within policy | staging recovery drill required |
| Managed object storage | regional/provider incident | versioned object restore matches database recovery point | signed recovery drill required |

For every staging drill, retain the release Git SHA, immutable image digests,
failure start/recovery timestamps, affected job IDs, queue depth before/after,
and the signed recovery or rollback manifest. A 200 health response alone is
not sufficient: complete one authenticated PDF upload, processing, export, and
download after recovery.
