import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProductionComposeInvocation,
  resolveServiceEnvironmentPaths,
  validateServiceEnvironmentIsolation,
} from "./run-production-compose.mjs";

test("builds the approved immutable production Compose invocation", () => {
  const invocation = buildProductionComposeInvocation([
    ".env.production",
    "--profile",
    "character-rig",
    "up",
    "-d",
    "worker-character",
  ]);
  assert.equal(invocation.environmentFile.endsWith(".env.production"), true);
  assert.deepEqual(invocation.composeArguments.slice(-5), [
    "--profile",
    "character-rig",
    "up",
    "-d",
    "worker-character",
  ]);
});

test("rejects destructive commands and unknown profiles", () => {
  assert.throws(
    () => buildProductionComposeInvocation([".env.production", "down"]),
    /command is not approved/u,
  );
  assert.throws(
    () =>
      buildProductionComposeInvocation([
        ".env.production",
        "--profile",
        "debug",
        "up",
      ]),
    /profile is not approved/u,
  );
});

test("requires distinct environment files for every workload boundary", () => {
  const names = [
    "MOTIONPREP_MIGRATION_ENV_FILE",
    "MOTIONPREP_API_ENV_FILE",
    "MOTIONPREP_MAINTENANCE_ENV_FILE",
    "MOTIONPREP_MEDIA_WORKER_ENV_FILE",
    "MOTIONPREP_DOCUMENT_WORKER_ENV_FILE",
    "MOTIONPREP_EXPORT_WORKER_ENV_FILE",
    "MOTIONPREP_CHARACTER_WORKER_ENV_FILE",
  ];
  const source = names.map((name) => `${name}=${name}.env`).join("\n");
  assert.equal(
    resolveServiceEnvironmentPaths("C:/deploy/control.env", source).size,
    names.length,
  );
  assert.throws(
    () => resolveServiceEnvironmentPaths(
      "C:/deploy/control.env",
      source.replace(
        "MOTIONPREP_API_ENV_FILE=MOTIONPREP_API_ENV_FILE.env",
        "MOTIONPREP_API_ENV_FILE=MOTIONPREP_MIGRATION_ENV_FILE.env",
      ),
    ),
    /distinct environment file/u,
  );
});

test("rejects shared identities and API secrets in worker environments", () => {
  const isolated = new Map([
    ["MOTIONPREP_MIGRATION_ENV_FILE", "MOTIONPREP_WORKLOAD_IDENTITY=migrate\nMIGRATION_DATABASE_URL=postgresql://migrator:x@db/app?sslmode=require"],
    ["MOTIONPREP_API_ENV_FILE", "MOTIONPREP_WORKLOAD_IDENTITY=api\nDATABASE_URL=postgresql://api:x@db/app?sslmode=require"],
    ["MOTIONPREP_MAINTENANCE_ENV_FILE", "MOTIONPREP_WORKLOAD_IDENTITY=maintenance\nDATABASE_URL=postgresql://maintenance:x@db/app?sslmode=require"],
    ["MOTIONPREP_MEDIA_WORKER_ENV_FILE", "MOTIONPREP_WORKLOAD_IDENTITY=media\nDATABASE_URL=postgresql://media:x@db/app?sslmode=require"],
    ["MOTIONPREP_DOCUMENT_WORKER_ENV_FILE", "MOTIONPREP_WORKLOAD_IDENTITY=document\nDATABASE_URL=postgresql://document:x@db/app?sslmode=require"],
    ["MOTIONPREP_EXPORT_WORKER_ENV_FILE", "MOTIONPREP_WORKLOAD_IDENTITY=export\nDATABASE_URL=postgresql://export:x@db/app?sslmode=require"],
    ["MOTIONPREP_CHARACTER_WORKER_ENV_FILE", "MOTIONPREP_WORKLOAD_IDENTITY=character\nDATABASE_URL=postgresql://character:x@db/app?sslmode=require"],
  ]);
  assert.deepEqual(validateServiceEnvironmentIsolation(isolated), []);
  isolated.set(
    "MOTIONPREP_MEDIA_WORKER_ENV_FILE",
    "MOTIONPREP_WORKLOAD_IDENTITY=api\nDATABASE_URL=postgresql://api:x@db/app\nSTRIPE_SECRET_KEY=forbidden",
  );
  const violations = validateServiceEnvironmentIsolation(isolated);
  assert.equal(violations.some((entry) => entry.includes("API-only secret")), true);
  assert.equal(violations.some((entry) => entry.includes("reuses workload identity")), true);
  assert.equal(violations.some((entry) => entry.includes("reuses database role")), true);
});
