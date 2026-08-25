import assert from "node:assert/strict";
import test from "node:test";
import {
  collectBooleanFeatureFlags,
  findContractDrift,
} from "./verify-contract-baseline.mjs";

test("discovers feature flags from parsed configuration instead of schema formatting", () => {
  assert.deepEqual(
    collectBooleanFeatureFlags({
      PDF_REGION_OCR_ENABLED: false,
      CHARACTER_RIG_ENABLED: true,
      COOKIE_SECURE: true,
    }),
    {
      CHARACTER_RIG_ENABLED: "true",
      PDF_REGION_OCR_ENABLED: "false",
    },
  );
  assert.throws(
    () => collectBooleanFeatureFlags({ COOKIE_SECURE: true }),
    /No boolean feature flags/u,
  );
});

test("accepts an exact contract snapshot", () => {
  const snapshot = {
    routes: ["GET /v1/health"],
    scripts: { build: ["build"] },
  };
  assert.deepEqual(findContractDrift(snapshot, structuredClone(snapshot)), []);
});

test("reports additions, removals, and changed contract values", () => {
  const differences = findContractDrift(
    {
      routes: ["GET /v1/health", "POST /v1/projects"],
      scripts: { test: ["test"] },
      featureFlags: { CHARACTER_RIG_ENABLED: "true" },
    },
    {
      routes: ["GET /v1/health"],
      scripts: { build: ["build"] },
      featureFlags: { CHARACTER_RIG_ENABLED: "false" },
    },
  );

  assert.match(differences.join("\n"), /routes/u);
  assert.match(differences.join("\n"), /scripts\.build: missing/u);
  assert.match(differences.join("\n"), /scripts\.test: added/u);
  assert.match(differences.join("\n"), /CHARACTER_RIG_ENABLED/u);
});
