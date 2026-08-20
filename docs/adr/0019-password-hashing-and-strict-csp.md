# ADR 0019: Password work-factor migration and strict style CSP

## Status

Accepted on 2026-08-16.

## Context

The original password encoding stored explicit scrypt parameters but used
`N=2^14, r=8, p=1`, below the current OWASP equivalent configurations. The
public proxy also enforced `style-src 'self' 'unsafe-inline'` while measuring a
stricter report-only policy. The production React application uses dynamic
style properties for document geometry and virtualization, so compatibility
must be proven in real browser engines before enforcing the stricter policy.

## Decision

- New password hashes use `scrypt$v3` with `N=2^15, r=8, p=3` and a 64 MiB
  memory ceiling. This is one of OWASP's equivalent minimum scrypt profiles.
- Verification accepts only the exact legacy, v2, and current v3 profiles. It
  never trusts attacker-controlled work factors from a stored string.
- A successful first-factor login for an active account progressively replaces
  legacy and v2 hashes with v3. Existing hashes remain usable during rollout.
- The concurrent staging PDF workflow remains the production-shaped capacity
  gate: it registers at least four accounts concurrently and rejects any error
  rate, while the API CPU and memory limits remain explicit release inputs.
- The web preview used by Playwright emits the same strict style policy as the
  public proxy. Every browser journey records `securitypolicyviolation` events
  and fails if any occur.
- Production enforces `style-src 'self'` without `unsafe-inline`. Sanitized CSP
  reports are counted using bounded labels, exposed to Prometheus, charted in
  Grafana, and connected to an operator alert and runbook.
- Dynamic React style properties are retained where they encode arbitrary
  geometry. The enforced browser matrix proves they are applied through DOM
  style properties without violating the policy; replacing them with a custom
  styling abstraction would add risk without improving the enforced outcome.

## Consequences

Password verification consumes more CPU than v2. The repository history keeps
commit `00283ea` as the compatibility release that can verify v3 while still
writing v2; deploy that compatibility release before enabling this commit in a
production environment that requires rollback to an older image. Once v3
writing is enabled, the rollback target must be `00283ea` or a descendant and
must never be the pre-v3 release.

The local reference run on
2026-08-16 measured five sequential hash-and-verify operations at 413–454 ms
and four concurrent hashes in 234 ms; this evidence is directional only, and
the production-shaped load gate remains authoritative. Rollback may restore
the previous application because v3 verification ships with this release and
must remain supported in future releases.

The CSP migration no longer depends on an indefinite report-only window.
Browser and operational telemetry make policy regressions visible without
weakening the header. Reports remain sanitized and do not retain document paths
or query values.
