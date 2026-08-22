# Contributing to MotionPrep Studio

MotionPrep Studio is proprietary software. Public access to this repository does
not grant permission to copy, redistribute, host, or create derivative works.
See [LICENSE](LICENSE) before using any repository material.

External pull requests are not accepted unless a maintainer has invited the
contribution in writing. Collaborators should use the workflow below.

## Before starting

- Use a public issue only for non-sensitive product defects or proposals.
- Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md).
- Confirm the user problem, measurable outcome, minimum scope, and non-goals.
- Prefer a small, reversible change. Record expensive or hard-to-reverse
  architecture decisions under `docs/adr/`.

## Local setup

The supported toolchain is defined by `.node-version`, `package.json`, and
`.npmrc`. Do not bypass version checks with `--force`.

```sh
npm install
docker compose up -d
npm run db:migrate --workspace @motionprep/api
npm run dev:stack
```

Use generated or redacted test data only. Never commit credentials, production
exports, customer uploads, access tokens, private keys, or unredacted logs.

## Branches and pull requests

1. Branch from the latest `main` using a short descriptive name such as
   `fix/upload-integrity` or `feat/export-review`.
2. Keep the pull request focused on one outcome and avoid unrelated formatting
   or dependency changes.
3. Add or update automated tests for changed behavior.
4. Document configuration, migration, monitoring, rollback, and operational
   impact where relevant.
5. Complete the pull request template and wait for all required checks.
6. Resolve review conversations before merge. Never bypass branch protection.

At minimum, run the checks relevant to the change:

```sh
npm run lint
npm run typecheck
npm run test
npm run build
```

Use `npm run quality` before release-impacting changes when the full local
environment is available.

## Database and production changes

- Migrations must be additive or follow an explicitly documented expand/contract
  sequence. Include rollback or recovery instructions.
- New external dependencies require an owner, timeout/retry policy, failure
  behavior, and a removal path.
- Production-facing features require useful logs or metrics, safe disablement,
  and an updated runbook.
- Never claim production readiness from local success alone; reference the
  relevant evidence and external gates.

## Review checklist

- The acceptance criteria are testable and covered.
- Authorization, validation, privacy, and abuse cases were considered.
- No secrets or sensitive data were added to code, fixtures, logs, or artifacts.
- Documentation and examples match the implemented behavior.
- The change can be rolled back or disabled safely.
- Ownership and operational follow-up are clear.
