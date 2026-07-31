# Security policy

Do not report vulnerabilities in public issues. Share the affected endpoint, reproduction steps, impact, and request ID through the private security contact configured for the deployment.

## Current security status

- Authentication and payment flows are development/sandbox implementations.
- Do not enable `PAYMENT_MODE=live` until provider adapters and signed webhook verification exist.
- Do not run multiple API instances while repositories are in memory.
- Production must set `COOKIE_SECURE=true`, TLS at the edge, and a production-only secret/config store.

Never include passwords, session cookies, uploaded content, book text, payment tokens, or provider secrets in reports or logs.

