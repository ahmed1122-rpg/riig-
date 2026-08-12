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
2. snapshot all owned source, derived-raster, revision, and export object keys;
3. delete those objects with bounded concurrency;
4. remove derived-asset ownership metadata, then delete owned projects and
   their dependent workflow records in one transaction;
5. clear provider identifiers and anonymize the retained user, billing, and
   audit identity;
6. mark the durable request complete.

If object storage fails, the request is marked `failed`, the account stays
suspended, and the retention scheduler retries it. A failed request must never
be manually marked complete without proving every captured object key is gone.

## Triage

```sql
SELECT id, user_id, status, attempt, requested_at, updated_at,
       completed_at, last_error, cardinality(object_keys) AS remaining_keys
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
- A completed request must have zero owned projects, no captured keys, revoked
  sessions, cleared provider identifiers, and an anonymized email.
