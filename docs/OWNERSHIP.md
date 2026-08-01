# Module ownership

The repository currently has one accountable GitHub owner,
`@ahmed1122-rpg`. The table makes operational boundaries explicit even while
the team is small. Add a second reviewer or on-call contact before production
if ownership is delegated; do not leave a critical domain without a named
human owner.

| Domain | Primary paths | Operational responsibility | Required evidence |
|---|---|---|---|
| Authentication and security | `apps/api/src/auth`, security middleware | Sessions, MFA, resets, secret rotation, abuse controls | API security tests, audit events, secret-rotation drill |
| Uploads and source versions | `apps/api/src/uploads`, `apps/api/src/sources`, object storage | Multipart limits, integrity, reconciliation, retention | S3 integration, interrupted-upload recovery, lifecycle proof |
| Media and document processing | `apps/api/src/processing`, `apps/worker-media`, `apps/worker-document` | Queue leases, OCR review, resource ceilings, retries | Worker integration, representative PDF load, fault recovery |
| Export | `apps/api/src/exports`, `apps/worker-export`, `packages/export-adapters` | Preflight, artifact integrity, Adobe compatibility, expiry | Export tests, signed Adobe golden evidence, load profile |
| Billing | `apps/api/src/billing`, web billing feature | Provider callbacks, entitlements, usage ledger | Signed-webhook tests, reconciliation, live-provider staging |
| Workspace UX | `apps/web/src/features/workspace` | Autosave, interruption recovery, review and export flows | Unit tests, Playwright critical journeys, accessibility scan |
| Operations and release | `compose.production.yaml`, `deploy`, `.github/workflows`, runbooks | Deployment, monitoring, backup, rollback, incident response | Staging smoke, signed images, recovery and rollback drills |
| Shared contracts | `packages/contracts`, database migrations | Compatible schemas and state invariants | Typecheck, migration integration, backward-compatible rollout |

Changes that cross two rows require review against both sets of evidence. The
release owner records the commit SHA, image digests, test results, security
results, staging result, and rollback result in the release evidence bundle.
