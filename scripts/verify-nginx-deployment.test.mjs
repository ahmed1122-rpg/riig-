import assert from "node:assert/strict";
import test from "node:test";
import {
  verifyNginxDeployment,
  verifyNginxRuntimeWiring,
} from "./verify-nginx-deployment.mjs";

const validNginx = `
client_max_body_size 30m;
set_real_ip_from \${TRUSTED_PROXY_CIDR};
real_ip_header X-Forwarded-For;
real_ip_recursive on;
proxy_pass http://api:4000;
location = /readyz { proxy_pass http://api:4000/v1/health/ready; }
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $motionprep_forwarded_proto;
include /etc/nginx/snippets/security-headers.conf;
include /etc/nginx/snippets/security-headers.conf;
include /etc/nginx/snippets/security-headers.conf;
`;

test("accepts the trusted proxy and all-path security header contract", () => {
  const securityHeaders = `
add_header Strict-Transport-Security;
add_header Reporting-Endpoints 'csp-endpoint="/v1/security/csp-report"';
add_header Content-Security-Policy "style-src 'self'; report-uri /v1/security/csp-report; report-to csp-endpoint";
`;
  assert.deepEqual(
    verifyNginxDeployment(validNginx, securityHeaders),
    [],
  );
});

test("rejects an enforced CSP that retains unsafe-inline", () => {
  const violations = verifyNginxDeployment(
    validNginx,
    `add_header Strict-Transport-Security;
add_header Reporting-Endpoints 'csp-endpoint="/v1/security/csp-report"';
add_header Content-Security-Policy "style-src 'self' 'unsafe-inline'; report-uri /v1/security/csp-report; report-to csp-endpoint";`,
  );
  assert.match(violations.join("\n"), /must not allow unsafe inline/u);
});

test("rejects spoofable forwarding and missing location headers", () => {
  const violations = verifyNginxDeployment(
    validNginx
      .replace("real_ip_recursive on;", "")
      .replace("proxy_set_header X-Forwarded-For $remote_addr;", "")
      .replaceAll("include /etc/nginx/snippets/security-headers.conf;", ""),
    "",
  );
  assert.match(violations.join("\n"), /real_ip_recursive on/u);
  assert.match(violations.join("\n"), /X-Forwarded-For \$remote_addr/u);
  assert.match(violations.join("\n"), /emit HSTS/u);
  assert.match(violations.join("\n"), /retain security headers/u);
});

const validRuntimeWiring = `
--add-host api:127.0.0.1
--env TRUSTED_PROXY_CIDR=127.0.0.1/32
--env TRUSTED_PROXY_CIDR=invalid
--tmpfs /etc/nginx/conf.d:rw,size=1m,mode=1777
/etc/nginx/conf.d:size=1m,mode=1777
`;

test("accepts bounded template rendering in Compose and image smokes", () => {
  assert.deepEqual(
    verifyNginxRuntimeWiring({
      compose: validRuntimeWiring,
      ciWorkflow: validRuntimeWiring,
      releaseWorkflow: validRuntimeWiring,
    }),
    [],
  );
});

test("rejects read-only image smokes without template output tmpfs", () => {
  const violations = verifyNginxRuntimeWiring({
    compose: "",
    ciWorkflow: "",
    releaseWorkflow: "",
  });
  assert.match(violations.join("\n"), /CI web smoke/u);
  assert.match(violations.join("\n"), /Release web smoke/u);
  assert.match(violations.join("\n"), /Production web/u);
});
