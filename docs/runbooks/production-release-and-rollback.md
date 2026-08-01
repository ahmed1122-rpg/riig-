# Production release and rollback runbook

## Before release

1. Confirm CI is green, the database backup is current, and the signed release
   artifact contains digest-qualified `RUNTIME_IMAGE_REF` and `WEB_IMAGE_REF`
   values, exact `RELEASE_GIT_SHA`, and `release-evidence.json`. Production does
   not accept image tags or a release SHA that differs from the image manifest.
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
docker compose --env-file .env.production -f compose.production.yaml pull
docker compose --env-file .env.production -f compose.production.yaml up -d
```

Check `/healthz`, `/v1/health/live`, and `/v1/health/ready`; readiness must report
the expected application version and `RELEASE_GIT_SHA`. Inspect structured API
and worker logs using the returned request ID/correlation ID for error rate and
processing duration. Run `staging-application-readiness` to complete the
authenticated PDF upload, processing, export, and download journey, then retain
its JSON evidence beside the immutable release bundle.

## Rollback

If health or the core journey fails:

1. Restore both digest-qualified references from the saved rollback manifest.
2. Pull those exact digests and run
   `docker compose --env-file .env.production -f compose.production.yaml up -d`.
3. Re-run health and smoke checks.
4. Do not reverse an additive migration during the incident. Roll application
   code back first; create a forward repair migration after service is stable.
5. Record start/end timestamps, restored digests, readiness release identity,
   queue recovery, and the post-rollback PDF journey in the rollback evidence.

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
