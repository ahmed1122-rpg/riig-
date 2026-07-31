import { createHash, randomUUID } from "node:crypto";
import { hasExpectedObjectIntegrity } from "../apps/api/dist/storage/object-integrity.js";
import { S3ObjectStorage } from "../apps/api/dist/storage/s3-object-storage.js";

const bucket = required("OBJECT_STORAGE_BUCKET");
const region = process.env.OBJECT_STORAGE_REGION?.trim() || "us-east-1";
const endpoint = optional("OBJECT_STORAGE_ENDPOINT");
const accessKeyId = optional("OBJECT_STORAGE_ACCESS_KEY");
const secretAccessKey = optional("OBJECT_STORAGE_SECRET_KEY");
const sessionToken = optional("OBJECT_STORAGE_SESSION_TOKEN");
const forcePathStyle = parseBoolean(
  process.env.OBJECT_STORAGE_FORCE_PATH_STYLE,
  false,
);
const requireVersioning = parseBoolean(
  process.env.OBJECT_STORAGE_REQUIRE_VERSIONING,
  false,
);
const encryptionMode = required("OBJECT_STORAGE_ENCRYPTION_MODE");

if (!["bucket-default", "sse-s3"].includes(encryptionMode)) {
  throw new Error(
    "Provider smoke verification requires bucket-default or sse-s3 encryption.",
  );
}
if (!requireVersioning) {
  throw new Error(
    "Provider smoke verification requires OBJECT_STORAGE_REQUIRE_VERSIONING=true.",
  );
}
if (Boolean(accessKeyId) !== Boolean(secretAccessKey)) {
  throw new Error(
    "OBJECT_STORAGE_ACCESS_KEY and OBJECT_STORAGE_SECRET_KEY must be provided together.",
  );
}
if (sessionToken && !(accessKeyId && secretAccessKey)) {
  throw new Error(
    "OBJECT_STORAGE_SESSION_TOKEN requires explicit access and secret keys.",
  );
}
if (endpoint && new URL(endpoint).protocol !== "https:") {
  throw new Error("Provider smoke verification requires an HTTPS endpoint.");
}

const storage = new S3ObjectStorage({
  ...(endpoint ? { endpoint } : {}),
  region,
  bucket,
  ...(accessKeyId && secretAccessKey
    ? {
        accessKeyId,
        secretAccessKey,
        ...(sessionToken ? { sessionToken } : {}),
      }
    : {}),
  forcePathStyle,
  encryptionMode,
  requireVersioning,
});
const probeId = randomUUID();
const key = `artifacts/provider-smoke/${probeId}.bin`;
const body = Buffer.from(`motionprep-object-storage-smoke:${probeId}`, "utf8");
const expectation = {
  contentType: "application/octet-stream",
  sizeBytes: body.byteLength,
  sha256: createHash("sha256").update(body).digest("hex"),
};
let stored = false;

try {
  await storage.ready(false);
  await storage.put({
    key,
    ...expectation,
    body,
  });
  stored = true;
  const retrieved = await storage.get(key);
  if (!retrieved || !hasExpectedObjectIntegrity(retrieved, expectation)) {
    throw new Error("Object-storage provider returned a mismatched probe.");
  }
  await storage.delete(key);
  stored = false;
  if (await storage.get(key)) {
    throw new Error("Object-storage provider did not delete the probe.");
  }
  process.stdout.write(
    `${JSON.stringify({
      verified: true,
      region,
      endpoint: endpoint ? new URL(endpoint).origin : "aws-default",
      bucket,
      encryptionMode,
      credentialMode: accessKeyId ? "explicit" : "default-provider-chain",
    })}\n`,
  );
} finally {
  if (stored) await storage.delete(key);
  storage.destroy();
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function required(name) {
  const value = optional(name);
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("OBJECT_STORAGE_FORCE_PATH_STYLE must be true or false.");
}
