import assert from "node:assert/strict";
import test from "node:test";
import { parse } from "yaml";
import { verifyRuntimeImageContract } from "./verify-runtime-image-contract.mjs";

const compose = parse(`
x-runtime: &runtime
  image: runtime@sha256:abc
services:
  api:
    <<: *runtime
    command: [node, --conditions=production, apps/api/dist/server.js]
  worker-character:
    <<: *runtime
    command: [node, --conditions=production, apps/worker-character/dist/index.js]
    healthcheck:
      test: [CMD, node, scripts/check-worker-health.mjs, character]
  web:
    image: web@sha256:def
    command: [nginx]
`);

test("accepts every Compose executable copied into the runtime image", () => {
  assert.deepEqual(
    verifyRuntimeImageContract({
      dockerfile: completeDockerfile(),
      composeDocument: compose,
    }),
    [],
  );
});

test("rejects a runtime workspace omitted from the final image", () => {
  const dockerfile = completeDockerfile().replace(
    /COPY --from=build \/workspace\/apps\/worker-character\/dist \.\/apps\/worker-character\/dist\r?\n/u,
    "",
  );
  assert.deepEqual(verifyRuntimeImageContract({ dockerfile, composeDocument: compose }), [
    "Runtime service worker-character executes apps/worker-character/dist/index.js, but the final image does not copy that path.",
  ]);
});

test("rejects a runtime workspace omitted from the npm ci manifest set", () => {
  const dockerfile = completeDockerfile().replace(
    /COPY apps\/worker-character\/package\.json \.\/apps\/worker-character\/package\.json\r?\n/u,
    "",
  );
  assert.deepEqual(verifyRuntimeImageContract({ dockerfile, composeDocument: compose }), [
    "Runtime service worker-character uses apps/worker-character, but its package manifest is not copied before npm ci.",
  ]);
});

function completeDockerfile() {
  return `FROM node AS build
COPY apps/api/package.json ./apps/api/package.json
COPY apps/worker-character/package.json ./apps/worker-character/package.json
RUN npm ci
FROM node AS runtime
COPY --from=build /workspace/apps/api/dist ./apps/api/dist
COPY --from=build /workspace/apps/worker-character/dist ./apps/worker-character/dist
COPY --from=build /workspace/scripts/check-worker-health.mjs ./scripts/check-worker-health.mjs
`;
}
