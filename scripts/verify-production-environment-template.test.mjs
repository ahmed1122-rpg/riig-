import assert from "node:assert/strict";
import test from "node:test";
import { verifyWorkerEnvironmentParity } from "./verify-production-environment-template.mjs";

const common = `
NODE_ENV=production
MOTIONPREP_WORKLOAD_IDENTITY=worker
DATABASE_URL=postgresql://db/app
DATABASE_POOL_MAX=5
OBJECT_STORAGE_REGION=eu-central-1
OBJECT_STORAGE_BUCKET=private
OBJECT_STORAGE_ACCESS_KEY=
OBJECT_STORAGE_SECRET_KEY=
OBJECT_STORAGE_SESSION_TOKEN=
OBJECT_STORAGE_FORCE_PATH_STYLE=false
OBJECT_STORAGE_ENCRYPTION_MODE=bucket-default
OBJECT_STORAGE_REQUIRE_VERSIONING=true
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=
OTEL_EXPORTER_OTLP_HEADERS=
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1
`;

test("requires every worker template to retain shared durable and tracing keys", () => {
  assert.deepEqual(
    verifyWorkerEnvironmentParity({ standard: common, character: common }),
    [],
  );
  assert.match(
    verifyWorkerEnvironmentParity({ character: common.replace("OTEL_TRACES_SAMPLER=", "REMOVED=") }).join("\n"),
    /character worker template is missing common key OTEL_TRACES_SAMPLER/u,
  );
});
