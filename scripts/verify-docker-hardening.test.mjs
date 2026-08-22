import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { verifyDockerHardening } from "./verify-docker-hardening.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = await Promise.all(
  [
    "Dockerfile",
    "Dockerfile.web",
    "Dockerfile.qa",
    ".dockerignore",
    "compose.yaml",
    "compose.integration.yaml",
  ].map((file) => readFile(join(root, file), "utf8")),
);
const valid = {
  runtimeDockerfile: files[0],
  webDockerfile: files[1],
  qaDockerfile: files[2],
  dockerignore: files[3],
  localCompose: files[4],
  integrationCompose: files[5],
};

test("repository Docker artifacts satisfy the hardening contract", () => {
  assert.deepEqual(verifyDockerHardening(valid), []);
});

test("rejects non-deterministic upgrades and a root QA runtime", () => {
  const violations = verifyDockerHardening({
    ...valid,
    runtimeDockerfile: `${valid.runtimeDockerfile}\nRUN apt-get upgrade --yes\n`,
    qaDockerfile: valid.qaDockerfile.replace("USER node", "USER root"),
  });
  assert.ok(violations.some((message) => message.includes("apt-get upgrade")));
  assert.ok(violations.some((message) => message.includes("non-root node user")));
});

test("rejects an incomplete QA dependency-cache manifest set", () => {
  const violations = verifyDockerHardening({
    ...valid,
    qaDockerfile: valid.qaDockerfile.replace(
      "COPY packages/layer-domain/package.json ./packages/layer-domain/package.json\n",
      "",
    ),
  });
  assert.ok(
    violations.some((message) => message.includes("layer-domain workspace manifest")),
  );
});

test("rejects ports exposed beyond loopback", () => {
  const violations = verifyDockerHardening({
    ...valid,
    localCompose: valid.localCompose.replace("127.0.0.1:5432:5432", "0.0.0.0:5432:5432"),
  });
  assert.ok(violations.some((message) => message.includes("bind every published port")));
});

test("rejects weakened integration isolation", () => {
  const violations = verifyDockerHardening({
    ...valid,
    integrationCompose: valid.integrationCompose
      .replace("  read_only: true", "  read_only: false")
      .replace("  cap_drop:\n    - ALL", "  cap_drop: []"),
  });
  assert.ok(violations.some((message) => message.includes("read-only root filesystem")));
  assert.ok(violations.some((message) => message.includes("drop all Linux capabilities")));
});

test("rejects a second init process in front of direct clamd", () => {
  const violations = verifyDockerHardening({
    ...valid,
    integrationCompose: valid.integrationCompose.replace(
      "  clamav:\n",
      "  clamav:\n    init: true\n",
    ),
  });
  assert.ok(violations.some((message) => message.includes("second Compose init")));
});

test("rejects ClamAV mirror downloads and weakened container isolation", () => {
  const violations = verifyDockerHardening({
    ...valid,
    integrationCompose: valid.integrationCompose
      .replace('    entrypoint: ["clamd", "--foreground"]', '    entrypoint: ["/init"]')
      .replaceAll("    user: clamav", "    user: root"),
  });
  assert.ok(violations.some((message) => message.includes("public databases")));
  assert.ok(violations.some((message) => message.includes("non-root user")));
});

test("rejects ClamAV startup without a fresh local CUD gate", () => {
  const violations = verifyDockerHardening({
    ...valid,
    integrationCompose: valid.integrationCompose.replace(
      "        condition: service_completed_successfully",
      "        condition: service_started",
    ),
  });
  assert.ok(violations.some((message) => message.includes("fresh local CUD")));
});

test("rejects a read-only release web without writable rendered configuration", () => {
  const violations = verifyDockerHardening({
    ...valid,
    integrationCompose: valid.integrationCompose.replace(
      "      - /etc/nginx/conf.d:size=1m,mode=1777\n",
      "",
    ),
  });
  assert.ok(
    violations.some((message) => message.includes("rendered Nginx configuration")),
  );
});

test("rejects unbounded logs and missing build-context exclusions", () => {
  const violations = verifyDockerHardening({
    ...valid,
    dockerignore: valid.dockerignore.replace("test-results", ""),
    integrationCompose: valid.integrationCompose.replace(
      "    logging: *bounded-logging\n\nnetworks:",
      "\nnetworks:",
    ),
  });
  assert.ok(violations.some((message) => message.includes("ignore test-results")));
  assert.ok(violations.some((message) => message.includes("bounded local logging")));
});
