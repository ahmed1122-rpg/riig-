# Account privacy operations

## Scope

This runbook covers versioned legal consent, account data export, and durable
account deletion. It does not replace jurisdiction-specific legal review.

## Data export

`GET /v1/account/export` requires an active session. Schema version 2 returns
JSON metadata for the account, legal acceptance, projects, source versions,
exports, billing records, audit events, current and retained layer documents,
restore history, processing/review records, and all owned Character bibles,
references, generations, reviews, rigs, and jobs. It deliberately excludes
password hashes, MFA secrets, provider customer identifiers, Character provider
handles, worker leases, private object keys, and file bytes.

## Account deletion

`DELETE /v1/account` requires the current password and the literal confirmation
`DELETE`. A live Stripe subscription in `trialing`, `active`, or `past_due`
blocks deletion until cancellation. Accepted requests:

1. suspend the account and revoke sessions and recovery challenges;
2. reject new projects, billable subscription transitions, project work, and
   artifact publication by database trigger;
3. drain job leases and durable object-write leases, including a 15-minute
   post-write publication window, then wait an additional reconciliation grace
   period;
4. rebuild both the database key inventory and all owned project prefixes;
5. permanently delete every S3 object version and delete marker in that
   inventory, then verify that the prefixes are empty;
6. lock projects before the derived registry, remove the owned graph, clear
   provider identifiers, and anonymize the retained user identity in one
   transaction;
7. retain only the object count and SHA-256 inventory digest and mark the
   durable request complete.

The scheduler claims each deletion request with a durable processor lease, so
parallel API/scheduler attempts do not normally run the same purge. Object
writes acquire a database lease while holding a key-share lock on the owner;
the lease is renewed during the write. Failed or ambiguous unpublished writes
use exact permanent purge rather than a normal delete marker. The write-to-
publication fence is intentionally bounded to 15 minutes. Publication after
that bound is still rejected by tombstone triggers and its unpublished object
is permanently cleaned, but this does not replace short, observable database
publication transactions.

If object storage fails, the request is marked `failed`, the account stays
suspended, and the retention scheduler retries it. A failed request must never
be manually marked complete without proving every captured object key is gone.

## Triage

```sql
SELECT id, user_id, status, phase, attempt, requested_at, updated_at,
       drained_at, completed_at, last_error,
       processor_lease_id, processor_lease_expires_at,
       inventory_object_count, inventory_digest,
       cardinality(object_keys) AS remaining_keys,
       cardinality(object_prefixes) AS owned_prefixes
FROM account_deletion_requests
WHERE status <> 'completed'
ORDER BY updated_at;
```

Check the maintenance scheduler and the `MotionPrepRetentionMaintenanceStale`
alert. Restore storage access first, then run the normal retention task; do not
delete request rows to force a retry.

## Release checks

- Registering without the exact current policy versions must fail.
- Export must contain no secrets or object keys.
- Active live billing must block deletion.
- An injected storage failure must remain retryable.
- A project/object-write/billable-subscription race after tombstoning must fail
  closed.
- A ready Character identity model must prevent reference expiration.
- A versioned-bucket purge must remove current versions, historical versions,
  and delete markers.
- A completed request must have zero owned projects, no captured keys, revoked
  sessions, cleared provider identifiers, and an anonymized email.
