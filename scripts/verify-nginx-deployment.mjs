export function verifyNginxDeployment(nginx, securityHeaders) {
  const violations = [];
  if (!nginx.includes("client_max_body_size 30m")) {
    violations.push("Nginx request limit must match the 30 MiB application limit.");
  }
  if (!nginx.includes("proxy_pass http://api:4000")) {
    violations.push("Nginx must proxy the versioned API to the API service.");
  }
  if (!nginx.includes("location = /readyz") ||
      !nginx.includes("proxy_pass http://api:4000/v1/health/ready")) {
    violations.push("Nginx must expose /readyz through API readiness.");
  }
  for (const token of [
    "set_real_ip_from ${TRUSTED_PROXY_CIDR};",
    "real_ip_header X-Forwarded-For;",
    "real_ip_recursive on;",
    "proxy_set_header X-Forwarded-For $remote_addr;",
    "proxy_set_header X-Forwarded-Proto $motionprep_forwarded_proto;",
  ]) {
    if (!nginx.includes(token)) {
      violations.push(`Nginx trusted-proxy contract is missing token: ${token}`);
    }
  }
  if (!securityHeaders.includes("Strict-Transport-Security")) {
    violations.push("The public web proxy must emit HSTS on every response path.");
  }
  for (const token of [
    "Content-Security-Policy",
    "style-src 'self';",
    "report-uri /v1/security/csp-report",
    "report-to csp-endpoint",
    "Reporting-Endpoints",
  ]) {
    if (!securityHeaders.includes(token)) {
      violations.push(`The CSP migration contract is missing token: ${token}`);
    }
  }
  if (securityHeaders.includes("unsafe-inline")) {
    violations.push("The enforced CSP must not allow unsafe inline styles or scripts.");
  }
  const headerIncludes =
    nginx.match(/include \/etc\/nginx\/snippets\/security-headers\.conf;/gu) ?? [];
  if (headerIncludes.length < 3) {
    violations.push(
      "Nginx must retain security headers in locations that override Cache-Control.",
    );
  }
  return violations;
}

export function verifyNginxRuntimeWiring({
  compose,
  ciWorkflow,
  releaseWorkflow,
}) {
  const violations = [];
  const workflowTokens = [
    "--add-host api:127.0.0.1",
    "--env TRUSTED_PROXY_CIDR=127.0.0.1/32",
    "--tmpfs /etc/nginx/conf.d:rw,size=1m,mode=1777",
  ];
  for (const token of workflowTokens) {
    if (!ciWorkflow.includes(token)) {
      violations.push(`CI web smoke is missing Nginx runtime token: ${token}`);
    }
    if (!releaseWorkflow.includes(token)) {
      violations.push(`Release web smoke is missing Nginx runtime token: ${token}`);
    }
  }
  if (!compose.includes("/etc/nginx/conf.d:size=1m,mode=1777")) {
    violations.push(
      "Production web must provide a bounded tmpfs for Nginx template rendering.",
    );
  }
  return violations;
}
