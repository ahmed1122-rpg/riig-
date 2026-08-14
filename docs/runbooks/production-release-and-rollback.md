# Production release and rollback runbook

## Before release

1. Confirm CI is green, the database backup is current, and the signed release
   artifact contains digest-qualified `RUNTIME_IMAGE_REF` and `WEB_IMAGE_REF`
   values, exact `RELEASE_GIT_SHA`, and `release-evidence.json`. Production does
   not accept image tags or a release SHA that differs from the image manifest.
   Run `npm run verify:release-checkout -- --verify-images` from the exact tag
   checkout; it fails on a dirty tree, SHA/tag/version drift, mutable
   references, or a repository-bound Cosign identity mismatch.
2. Review pending migrations. Production migrations must remain additive-first.
3. Confirm queue depth is stable and no export backlog is growing.
4. Save the current two digest-qualified image references as the rollback
   manifest. Keep this manifest outside the deployment host.
5. Require protected provider dependency, staging application, and performance
   evidence for the same release SHA. Require a signed recovery drill within
   policy and a documented rollback rehearsal before approving production.

## Release

Copy the two exact references from the release artifact into
`.env.production`, verify their signatures, and run:

```bash
node scripts/verify-release-environment.mjs .env.production
cosign verify \
  --certificate-identity 'https://github.com/<owner>/<repo>/.github/workflows/release-images.yml@refs/tags/<release-tag>' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$RUNTIME_IMAGE_REF"
cosign verify \
  --certificate-identity 'https://github.com/<owner>/<repo>/.github/workflows/release-images.yml@refs/tags/<release-tag>' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  "$WEB_IMAGE_REF"
node scripts/run-production-compose.mjs .env.production pull
node scripts/run-production-compose.mjs .env.production up -d
```

Check `/healthz`, `/readyz`, `/v1/health/live`, and `/v1/health/ready`; readiness must report
the expected application version and `RELEASE_GIT_SHA`. Inspect structured API
and worker logs using the returned request ID/correlation ID for error rate and
processing duration. Run `staging-application-readiness` to complete the
authenticated PDF upload, processing, export, and download journey, then retain
its JSON evidence beside the immutable release bundle.

## Rollback

If health or the core journey fails:

1. Restore both digest-qualified references from the saved rollback manifest.
2. Pull those exact digests. If the candidate ran any additive migration, do
   **not** start the older `migrate` image: it correctly rejects migration files
   introduced after that image was built. Recreate only the application layer:

   ```bash
   node scripts/run-production-compose.mjs .env.production pull \
     api worker-media worker-document worker-export web maintenance-scheduler
   node scripts/run-production-compose.mjs .env.production up -d \
     --no-deps --force-recreate \
     api worker-media worker-document worker-export web maintenance-scheduler
   ```

   This is safe only because production migrations are additive-first and the
   previous application release has been proven compatible with the retained
   schema. Never run a reverse migration during incident rollback.
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

The command verifies repository-bound signatures, starts the candidate, runs a
PDF upload/process/export/download journey, performs an application-only
rollback without re-running migrations, repeats readiness/web/PDF checks, and
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
