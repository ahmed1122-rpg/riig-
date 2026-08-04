# MotionPrep Studio v0.1.3 production evidence

Date: 2026-08-04

## Immutable release identity

- Tag: `v0.1.3`
- Release Git SHA: `452cd9941bd085fcad88c08bec7284f94d6f9db9`
- Release workflow: `https://github.com/ahmed1122-rpg/riig-/actions/runs/30904738809`
- GitHub release: `https://github.com/ahmed1122-rpg/riig-/releases/tag/v0.1.3`
- Runtime image: `ghcr.io/ahmed1122-rpg/motionprep-runtime@sha256:b7afc62ded55d7b3c6808c92adf367a5c089175f12807cb8ee48555e53360d0e`
- Web image: `ghcr.io/ahmed1122-rpg/motionprep-web@sha256:00159a357e13abd8c021f877ec20c5b075668ec0da1df08cbf1358d384bd8804`

The protected workflow proved exact-SHA checkout, source quality, production
dependency audit, browser E2E, concurrent migrations, durable PostgreSQL/S3,
production-shaped topology, dependency fault recovery, concurrent PDF smoke,
container hardening, High/Critical Trivy scanning, SBOM/provenance, and
repository-bound Cosign verification.

## Rollback evidence

- Corrected drill source SHA: `0bb93a19ac166d0b5a8b35514a81591cab6b72ae`
- Passed workflow: `https://github.com/ahmed1122-rpg/riig-/actions/runs/30907536496`
- Rollback target: `v0.1.2` at
  `bdf378b57f04abd5d25d0d6b7d9f214ff04a63a8`
- Policy: apply candidate additive migrations once, never run older migrations,
  and recreate application services only for rollback.

The drill verified both releases' signatures and immutable images, candidate
and rollback readiness/web health, a candidate PDF journey, application-only
rollback, and a rollback PDF journey. Every check passed. Both journeys had a
0% error rate. Candidate workflow p95 was 1,258 ms and rollback workflow p95 was
1,206 ms. The one-journey smoke proves rollback correctness, not production
capacity.

## External launch gates still open

The `production-readiness` GitHub environment has no provider secrets and lacks
the managed staging, SMTP, S3, recovery, metrics, and representative-PDF
coordinates required by the protected external workflows. Consequently no
provider or staging success is claimed.

Remaining launch gates are:

1. managed TLS PostgreSQL, Redis, SMTP, and private versioned/encrypted S3
   readiness;
2. deployment of the exact signed digests to staging and a full staging smoke;
3. signed backup/restore recovery with measured RPO and RTO;
4. representative sustained PDF load with p95, memory, CPU, and queue ceilings;
5. owner/legal approval of privacy/controller/retention/subprocessor details;
6. licensed Adobe Golden validation; and
7. a fresh sealed OCR holdout before regional OCR can be enabled.

This record authorizes staging preparation with the immutable release. It does
not authorize an unconditional public production launch.
