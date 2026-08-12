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
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $motionprep_forwarded_proto;
include /etc/nginx/snippets/security-headers.conf;
include /etc/nginx/snippets/security-headers.conf;
include /etc/nginx/snippets/security-headers.conf;
`;

test("accepts the trusted proxy and all-path security header contract", () => {
  assert.deepEqual(
    verifyNginxDeployment(validNginx, "add_header Strict-Transport-Security"),
    [],
  );
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
