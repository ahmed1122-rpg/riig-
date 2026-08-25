# Production release and rollback runbook

## Before release

1. Confirm CI is green, the database backup is current, and the signed candidate
   artifact contains digest-qualified `RUNTIME_IMAGE_REF` and `WEB_IMAGE_REF`
   values, exact `RELEASE_GIT_SHA`, and `release-evidence.json`. Production does
   not accept image tags or a release SHA that differs from the image manifest.
   Run `npm run verify:release-checkout -- --candidate --verify-images` from the
   exact candidate checkout with
   `RELEASE_SIGNATURE_WORKFLOW=release-images.yml` and
   `RELEASE_SIGNATURE_IDENTITY_REF=refs/heads/main`; it fails on a dirty tree,
   SHA drift, mutable references, or a repository-bound candidate Cosign
   identity mismatch.
2. Review pending migrations. Production migrations must remain additive-first.
3. Confirm queue depth is stable and no export backlog is growing.
4. Save the current two digest-qualified image references as the rollback
   manifest. Keep this manifest outside the deployment host.
5. Require protected provider dependency, staging application, and performance
   evidence for the same release SHA. Require a signed recovery drill within
   policy and a documented rollback rehearsal before approving production.
6. Run `promote-release` with those successful workflow run IDs. It must pass
   the legal-document and zero-High/Critical-exception gates, sign the same
   digests with the promotion identity, and create the final tag without a
   rebuild. Use the stable release's attached, promotion-signed `release.env`
   after promotion; it carries
   `RELEASE_SIGNATURE_WORKFLOW=promote-release.yml` and
   `RELEASE_SIGNATURE_IDENTITY_REF=refs/heads/main`. A candidate artifact alone
   is not a production release.

## First malware-invariant rollout (migrations 044–045)

This is a one-time maintenance rollout. Do not use the ordinary rolling
sequence while any live release predates `worker-security` or the malware
publication invariant.

1. Put the public edge into an owned maintenance mode that blocks every API,
   upload, processing, export, and download request. Record the start time and
   incident/release owner. Pull the candidate digests without starting them.
2. Stop admission of new work, wait for the old processing/export queues and
   active-job counters to reach zero, then gracefully stop the entire old
   application fleet. Confirm no old API or worker heartbeat remains live:

   ```bash
   node scripts/run-production-compose.mjs .env.production pull
   node scripts/run-production-compose.mjs .env.production stop \
     api worker-media worker-document worker-export worker-security \
     worker-character web maintenance-scheduler
   ```

3. Apply migrations 044 and 045 from the candidate image with the old fleet
   still stopped. Never start a pre-045 image after this point:

   ```bash
   node scripts/run-production-compose.mjs .env.production up migrate
   ```

4. Start only `worker-security`. Keep the edge closed while it scans all valid
   legacy sources:

   ```bash
   node scripts/run-production-compose.mjs .env.production up -d worker-security
   ```

   Query PostgreSQL with the deployment-owned read-only operations role until
   `pending_backfills` is zero; investigate every `held_failures` row rather
   than deleting it:

   ```sql
   SELECT count(*) AS pending_backfills
   FROM malware_scan_jobs AS scan
   JOIN upload_sessions AS upload ON upload.upload_id = scan.upload_id
   WHERE upload.malware_scan_backfill = true
     AND scan.status IN ('queued', 'retry_wait', 'scanning');

   SELECT count(*) AS held_failures
   FROM upload_sessions
   WHERE malware_scan_backfill = true
     AND status = 'scan_failed'
     AND malware_scan_verdict = 'error';
   ```

5. Prove there is no required ready source without a clean verdict, then start
   the candidate fleet. Require `/readyz` and every worker heartbeat to report
   the candidate SHA before removing edge maintenance mode:

   ```sql
   SELECT count(*) AS unsafe_ready
   FROM upload_sessions
   WHERE status = 'ready'
     AND NOT (
       (malware_scan_required = true AND malware_scan_verdict = 'clean')
       OR (malware_scan_required = false AND malware_scan_verdict = 'pending')
     );

   SELECT count(*) AS forbidden_production_exemptions
   FROM upload_sessions
   WHERE malware_scan_required = false;
   ```

   `unsafe_ready`, `pending_backfills`, and `forbidden_production_exemptions`
   must all be zero. Preserve the signed query output and maintenance
   timestamps with the release evidence.

## Release

Copy the two exact references from the release artifact into
`.env.production`, verify their signatures, and run:

```bash
node scripts/verify-release-environment.mjs .env.production
cosign verify \
  --certificate-identity 'https://github.com/<owner>/<repo>/.github/workflows/promote-release.yml@refs/heads/main' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$RUNTIME_IMAGE_REF"
cosign verify \
  --certificate-identity 'https://github.com/<owner>/<repo>/.github/workflows/promote-release.yml@refs/heads/main' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$WEB_IMAGE_REF"
node scripts/run-production-compose.mjs .env.production pull
node scripts/run-production-compose.mjs .env.production up -d
```

Check `/healthz`, `/readyz`, `/v1/health/live`, and `/v1/health/ready`; readiness must report
the expected application version and `RELEASE_GIT_SHA`. Inspect structured API
and worker logs using the returned request ID/correlation ID for error rate and
processing duration. The authenticated staging PDF journey and every external
gate already passed before the stable release was created; do not substitute a
post-production smoke for that evidence.

## Rollback

If health or the core journey fails:

1. Restore both digest-qualified references from the saved rollback manifest.
2. Pull those exact digests. If the candidate ran any additive migration, do
   **not** start the older `migrate` image: it correctly rejects migration files
   introduced after that image was built. Recreate only the application layer:

   ```bash
   node scripts/run-production-compose.mjs .env.production pull \
     api worker-security worker-media worker-document worker-export web maintenance-scheduler
   node scripts/run-production-compose.mjs .env.production up -d \
     --no-deps --force-recreate \
     api worker-security worker-media worker-document worker-export web maintenance-scheduler
   ```

   This is safe only because production migrations are additive-first and the
   previous application release has been proven compatible with the retained
   schema. A release from before the required malware gate and
   `worker-security` existed is **not** an eligible rollback target. Never run a
   reverse migration during incident rollback.
3. Re-run health and smoke checks.
4. Do not reverse an additive migration during the incident. Roll application
   code back first; create a forward repair migration after service is stable.
5. Record start/end timestamps, restored digests, readiness release identity,
   queue recovery, and the post-rollback PDF journey in the rollback evidence.

Before production approval, rehearse the exact candidate and rollback digests:

```bash
npm run test:release-rollback -- candidate-release.env rollback-release.env \
  --repository <owner>/<repo> \
  --candidate-tag <candidate-tag> \
  --rollback-tag <previous-release-tag>
```

Build `candidate-release.env` from the candidate artifact
(`release-images.yml@refs/heads/main`) and `rollback-release.env` from the
previous stable release asset (`promote-release.yml@refs/heads/main`). The
protected workflow uses the explicit `RELEASE_SIGNATURE_WORKFLOW` and
`RELEASE_SIGNATURE_IDENTITY_REF` fields from each descriptor; tag-based or
mixed workflow identities are rejected. Configure the protected environment's
candidate pair as `RELEASE_SIGNATURE_WORKFLOW=release-images.yml` and
`RELEASE_SIGNATURE_IDENTITY_REF=refs/heads/main`; configure the baseline pair
as `ROLLBACK_SIGNATURE_WORKFLOW=promote-release.yml` and
`ROLLBACK_SIGNATURE_IDENTITY_REF=refs/heads/main` from the previous stable
asset.

The command verifies repository-bound signatures, starts the candidate, proves
the security/media/document/export worker heartbeats carry the candidate SHA,
runs a
PDF upload/process/export/download journey, performs an application-only
rollback including `worker-security` without re-running migrations, repeats
worker identity/readiness/web/PDF checks, and
writes `.tmp/release-rollback-evidence.json`.

If Cosign cannot be installed on an operator workstation, the local drill may
set `CANDIDATE_SIGNATURE_EVIDENCE_URI` and
`ROLLBACK_SIGNATURE_EVIDENCE_URI` to the exact successful GitHub Actions release
run URLs. This is recorded as external evidence, not treated as a local
verification. The protected `release-rollback-drill` workflow always installs
Cosign and repeats repository-bound verification itself.

If a migration is destructive or not backward compatible, stop the release
before deployment. It does not meet the production migration policy.

## Payment incident

Set `PAYMENT_MODE=disabled` and redeploy the API to stop new checkouts while
preserving existing projects and exports. Keep the webhook endpoint available
only if reconciliation is required. Reconcile Stripe event IDs against the
billing audit records before re-enabling checkout.

## Processing incident

Stop only the failing worker type. Uploads remain durable in object storage and
queued jobs remain in PostgreSQL. Restart with reduced concurrency after the
cause is identified. Never delete queued jobs as a recovery shortcut.
