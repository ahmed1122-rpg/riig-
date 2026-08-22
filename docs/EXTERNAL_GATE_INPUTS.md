# External gate inputs and execution order

## Current decision

The source candidate is locally verified but is not authorized for production.
Keep `CHARACTER_RIG_ENABLED=false`, `PDF_REGION_OCR_ENABLED=false`, and
`PAYMENT_MODE=disabled` until their independent gates pass. Turntable/Character
Studio supports image projects only; PDF and book projects are not an enablement
option.

## Inputs the platform owner must provide

Provide these values through protected GitHub environments and the deployment
secret manager, never through a committed `.env` file:

- target cloud account/project, region, public domain, DNS ownership, and the
  load balancer's narrow private source CIDR;
- TLS-required PostgreSQL 17 URL with point-in-time recovery enabled;
- authenticated `rediss://` endpoint;
- private S3-compatible bucket, region, encryption mode, lifecycle policy, and
  preferably a workload identity instead of static keys;
- dedicated SMTP host/account with required TLS;
- private HTTPS Character inference base URL and API key, including any genuine
  provider path prefix;
- Stripe live credentials and webhook secret only after the business enables
  billing;
- approved RPO/RTO, incident owners and alert destinations, privacy/legal
  contacts, retention policy, and launch approvers.

Use `.env.production.example` as the field inventory. Placeholder, plaintext,
partial credential, mixed identity/static-key, broad proxy, query-bearing
provider URL, and mutable image values are rejected by the existing verifiers.

## Required execution order

1. Merge the reviewed candidate and record its exact 40-character Git SHA.
2. Run protected hosted CI, including the QA image, durable PostgreSQL/S3 suite,
   browser E2E, scans, and the three repeated Character race gates.
3. From protected `main`, run `release-images` with the exact candidate SHA.
   Publish and verify signed, SBOM/provenance-bearing candidate images; retain
   their digest-qualified references and the descriptor identity
   `release-images.yml@refs/heads/main`. This step must not create a tag or
   stable GitHub Release.
4. Deploy staging with those exact digests while Character, regional OCR, and
   live billing remain disabled.
5. Run `staging-readiness` against managed PostgreSQL, Redis, S3, and SMTP, then
   run concurrent migrations and the durable integration suite.
6. Execute an isolated coordinated PostgreSQL/object-store restore, sign its
   recovery manifest, and pass `provider-readiness` against that exact release.
7. Run fault injection, representative load/memory, alert, and application-only
   rollback drills. Retain release-bound reports and prove queues drain to zero.
8. Configure the private Character inference provider and egress allowlist;
   verify timeout, retry, rate-limit, SHA, cleanup, heartbeat, and lease-loss
   behavior with non-production image fixtures.
9. Replace the draft Terms and Privacy documents with owner/legal-approved
   text, controller identity, contact, and approval metadata. Do not bypass
   `verify:release-legal`.
10. Run `promote-release` with the exact six successful run IDs. It must find
    zero High/Critical container risk acceptances, verify every integrity
    manifest and signature, re-sign the same digests without rebuilding, then
    create the final tag and stable release. Retain the attached, signed stable
    `release.env`; its image signature identity is
    `promote-release.yml@refs/heads/main` and it is the only eligible source for
    the next rollback baseline.
11. Validate the generated PSD/manifest with the approved Character Animator
   Golden procedure and obtain the required product/legal approval.
12. Start `worker-character`, enable the API flag for an internal image-only
    canary, observe dashboards and alerts, then expand gradually. The immediate
    rollback is to disable the flag and stop the worker without deleting durable
    state.

## Evidence required for a Go decision

- exact Git SHA and signed runtime/web image digests match every report;
- protected CI and security scans pass with zero High/Critical exception at
  stable promotion time;
- managed connectivity, migration, durable integration, restore RPO/RTO,
  representative load, fault recovery, and rollback all pass;
- Character inference and Character Animator evidence is tied to the same
  candidate, image fixtures only, with no unresolved P1 defect;
- dashboards, alerts, incident ownership, retention, privacy/legal, and billing
  approvals are recorded.

Until all applicable evidence exists, the truthful status is: locally ready for
review and hosted CI, externally pending, production No-Go.

Use [`VERIFICATION_TRACEABILITY.md`](VERIFICATION_TRACEABILITY.md) to map each
release claim to its source checks, external evidence, owner, and current gate.
