# Client experience response

Use this runbook for `MotionPrepClientLcpSlow`,
`MotionPrepClientErrorsHigh`, and `MotionPrepCspViolationDetected`.

1. Confirm the alert's release SHA and time window. Browser reports contain a
   sanitized route and stack only; they deliberately remove queries, email
   addresses, UUIDs, long hashes, and cross-origin URL details.
2. Compare `motionprep_client_errors_total` by `kind` and inspect structured
   `client.error_reported` logs. Performance samples use
   `client.performance_reported`; never request raw customer document text to
   diagnose a frontend failure.
   For CSP alerts, compare `motionprep_csp_violations_total` by `directive`,
   `disposition`, `browser`, and `release`, then inspect the sanitized
   `security.csp_violation_reported`
   logs. Treat enforced violations as release regressions. Do not weaken the
   policy or add `unsafe-inline`; reproduce the exact route and replace the
   incompatible rendering pattern.
3. For LCP, compare p75 by API instance and release, verify CDN/cache headers,
   the landing hero response, JS/CSS bundle budgets, and API readiness latency.
4. Reproduce against the exact release with production assets. Private source
   maps are build artifacts and must remain in the restricted release evidence
   store; do not serve `.map` files from Nginx or attach them to public issues.
5. If the regression began with the current release and safe mitigation is not
   immediate, use the application rollback workflow. Verify readiness, browser
   errors, and p75 LCP for at least 15 minutes after rollback.
