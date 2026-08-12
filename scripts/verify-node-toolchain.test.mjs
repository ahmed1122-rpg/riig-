import assert from "node:assert/strict";
import test from "node:test";
import { verifyNodeToolchain } from "./verify-node-toolchain.mjs";

const validManifest = JSON.stringify({
  packageManager: "npm@11.16.0",
  allowScripts: {
    "esbuild@0.28.1": true,
    "fsevents@2.3.2": true,
    "fsevents@2.3.3": true,
    protobufjs: false,
    "tesseract.js": false,
  },
  engines: { node: ">=24.18.1 <25", npm: ">=11.16.0 <12" },
  devEngines: {
    runtime: { name: "node", version: "24.18.1", onFail: "error" },
    packageManager: { name: "npm", version: "11.16.0", onFail: "error" },
  },
});
const validNpmConfig = "engine-strict=true\nstrict-allow-scripts=true\n";
const nodeImageDigest = "a".repeat(64);
const validDockerfile = [
  `FROM node:24.18.1-bookworm-slim@sha256:${nodeImageDigest} AS build`,
  "FROM build AS runtime-base",
  "FROM runtime-base AS runtime",
  "",
].join("\n");

test("accepts one Node and npm toolchain across manifests and images", () => {
  assert.deepEqual(
    verifyNodeToolchain({
      nodeVersion: "24.18.1",
      packageManifest: validManifest,
      npmConfig: validNpmConfig,
      dockerfiles: [validDockerfile],
    }),
    [],
  );
});

test("accepts pinned slim dependency and full-bookworm QA stages", () => {
  assert.deepEqual(
    verifyNodeToolchain({
      nodeVersion: "24.18.1",
      packageManifest: validManifest,
      npmConfig: validNpmConfig,
      dockerfiles: [validDockerfile],
      qaDockerfiles: [
        [
          `FROM node:24.18.1-bookworm-slim@sha256:${"a".repeat(64)} AS qa-dependencies`,
          `FROM node:24.18.1-bookworm@sha256:${"b".repeat(64)} AS qa`,
          "",
        ].join("\n"),
      ],
    }),
    [],
  );
});

test("reports version drift and unpinned Docker bases", () => {
  const violations = verifyNodeToolchain({
    nodeVersion: "24.18.1",
    packageManifest: JSON.stringify({
      packageManager: "npm@11.15.0",
      engines: { node: ">=22.12.0 <23", npm: ">=11.13.0 <12" },
    }),
    npmConfig: "strict-allow-scripts=false\n",
    dockerfiles: ["FROM node:22.12.0-bookworm-slim AS build\n"],
  });

  assert.match(violations.join("\n"), /engines\.node must be/u);
  assert.match(violations.join("\n"), /engines\.npm must be/u);
  assert.match(violations.join("\n"), /devEngines\.runtime/u);
  assert.match(violations.join("\n"), /devEngines\.packageManager/u);
  assert.match(violations.join("\n"), /engine-strict/u);
  assert.match(violations.join("\n"), /strict-allow-scripts/u);
  assert.match(violations.join("\n"), /allowScripts/u);
  assert.match(violations.join("\n"), /must be pinned by digest/u);
  assert.match(violations.join("\n"), /must match \.node-version/u);
});

test("rejects an undefined stage alias as an unpinned external image", () => {
  const violations = verifyNodeToolchain({
    nodeVersion: "24.18.1",
    packageManifest: validManifest,
    npmConfig: validNpmConfig,
    dockerfiles: [
      `${validDockerfile}FROM untrusted-runtime AS final\n`,
    ],
  });

  assert.deepEqual(violations, [
    "Dockerfile base image must be pinned by digest: FROM untrusted-runtime AS final",
  ]);
});

test("rejects digest drift between Node.js Docker build stages", () => {
  const violations = verifyNodeToolchain({
    nodeVersion: "24.18.1",
    packageManifest: validManifest,
    npmConfig: validNpmConfig,
    dockerfiles: [
      validDockerfile,
      validDockerfile.replace(nodeImageDigest, "b".repeat(64)),
    ],
  });

  assert.deepEqual(violations, [
    "Every Dockerfile must use one identical digest-pinned Node.js base image.",
  ]);
});
