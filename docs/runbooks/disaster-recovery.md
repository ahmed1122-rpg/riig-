# Disaster recovery runbook

## Recovery contract

The initial targets are RPO <= 15 minutes and RTO <= 4 hours. PostgreSQL is
the metadata authority, but a usable recovery also requires the private object
store and the exact runtime/web image digests. A database-only restore is not
a successful recovery if its ready sources, derived layers, or export
artifacts are unavailable.

Assumptions:

- managed PostgreSQL provides point-in-time recovery (PITR);
- the object store has versioning or a provider backup/snapshot with a
  documented restore timestamp;
- infrastructure configuration and secrets are recoverable from the
  deployment-owned secrets manager;
- release records retain the digest-qualified `RUNTIME_IMAGE_REF` and
  `WEB_IMAGE_REF` values.

## Required recovery manifest

For every drill or incident, record:

- incident/drill identifier and UTC start time;
- desired database recovery timestamp;
- database backup/PITR identity;
- object-store version/snapshot identity and its effective UTC timestamp;
- bucket name and encryption-key identity;
- runtime and web image digests;
- target environment and operator;
- expected data-loss window.

Stop if the database recovery timestamp is newer than the recoverable object
store state by more than the approved RPO. Advancing metadata beyond available
objects creates false-ready projects.

## Restore procedure

1. Isolate the recovery environment from production writes and payment
   webhooks.
2. Restore PostgreSQL to the selected UTC timestamp.
3. Restore the private object store to a snapshot/version state at or after
   that timestamp. Preserve the `sources/`, `derived/`, and `artifacts/`
   prefixes and encryption policy.
4. Configure the restored environment with new credentials. Do not reuse
   compromised credentials from the incident.
5. Deploy the recorded runtime and web image digests. Keep
   `PAYMENT_MODE=disabled` and usage enforcement in `shadow` until
   reconciliation passes.
6. Run migrations once. The checksum ledger must accept every previously
   applied migration and apply only missing additive migrations.
7. Start the API and workers, then verify readiness and worker heartbeats.
8. Run the object-storage probe using the recovery workload identity.
9. Reconcile metadata and bytes:
   - every ready source upload can be read and matches size/SHA-256;
   - a representative derived raster can be read and matches its metadata;
   - non-expired artifacts can be read or regenerated;
   - no queue is permanently leased to a missing worker;
   - subscription usage and ledger totals agree for the active periods.
10. Complete one image and one Arabic PDF journey from existing restored
    sources through review and a newly generated export.
11. Enable traffic for internal users, observe error rate/queue age, and only
    then restore public traffic and payment webhooks.

## Validation and evidence

Capture:

- timestamps for detection, restore start, API readiness, and completed smoke
  journey;
- database and object-store restore identities;
- health, worker, queue, migration-ledger, and object-probe output;
- IDs of the restored projects used for verification;
- measured RPO and RTO;
- unexplained missing/corrupt object count (must be zero for sampled live
  projects);
- an `attestation` object containing `algorithm: "Ed25519"`, the accountable
  `signer`, a UTC `signedAt` after smoke completion, and a base64 signature.

The signature covers a canonical JSON representation of the entire manifest
except `attestation.signature`. Keep the Ed25519 private key in the
deployment-owned signing service or hardware-backed secrets system; never
store it in the repository or GitHub environment. Configure only the public
PEM as the protected environment secret
`RECOVERY_SIGNING_PUBLIC_KEY_PEM`.

The drill fails if the smoke journey cannot open an existing ready source,
workers do not heartbeat, migration checksums drift, or a restored object
fails integrity verification.

Record the evidence using
`docs/runbooks/recovery-manifest.example.json`, replace its structural
placeholder signature with the real Ed25519 signature from the protected
signing service, then run:

```bash
node scripts/verify-recovery-manifest.mjs path/to/completed-manifest.json \
  --public-key path/to/recovery-public-key.pem
```

The validator rejects mutable image tags, database/object recovery points more
than 15 minutes apart, measured RPO or RTO misses, and any sampled missing or
corrupt object. With `--public-key`, it also rejects missing metadata, a
non-Ed25519 key, tampering, or an invalid signature. Store the signed manifest
with the provider restore logs.

## Failback

Do not merge recovered and old production databases. Choose one authority,
quiesce writes, take a final coordinated database/object-store recovery point,
and move traffic. Rotate temporary recovery credentials and retain evidence
according to the incident policy.

## Drill cadence

Run a staging restore drill quarterly and after material changes to the
database provider, bucket versioning/encryption, migration framework, or
backup policy. The service owner signs the result and tracks any RPO/RTO miss
to closure.
