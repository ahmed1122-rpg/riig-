import {
  integer,
  objectSchema,
  text,
} from "./openapi-schema-builders.js";

const nullableText = { type: ["string", "null"] };

const arrayOf = (items: Record<string, unknown>) => ({ type: "array", items });

const characterArtifactSchema = objectSchema(
  ["objectKey", "contentType", "sizeBytes", "sha256", "createdAt", "retentionExpiresAt"],
  {
    objectKey: text(),
    contentType: text(),
    sizeBytes: integer,
    sha256: text(),
    createdAt: text("date-time"),
    retentionExpiresAt: nullableText,
  },
);
export const characterBibleSchema = objectSchema(
  [
    "schemaVersion", "id", "projectId", "version", "revision", "status",
    "displayName", "identityDescription", "negativeConstraints",
    "distinguishingFeatures", "proportions", "palette", "materials",
    "createdByUserId", "approvedByUserId", "approvedAt", "createdAt", "updatedAt",
  ],
  {
    schemaVersion: { type: "string", const: "1.0" },
    id: text("uuid"), projectId: text("uuid"), version: integer, revision: integer,
    status: { type: "string", enum: ["draft", "approved", "retired"] },
    displayName: text(), identityDescription: text(),
    negativeConstraints: { type: "array", items: text() },
    distinguishingFeatures: { type: "array", items: text() },
    proportions: { type: "object", additionalProperties: true },
    palette: { type: "array", items: { type: "object" } },
    materials: { type: "array", items: { type: "object" } },
    createdByUserId: text("uuid"), approvedByUserId: nullableText,
    approvedAt: nullableText, createdAt: text("date-time"), updatedAt: text("date-time"),
  },
);
export const characterReferenceSchema = objectSchema(
  [
    "id", "projectId", "bibleId", "sourceVersionId", "role", "canonicalView",
    "rightsClassification", "rightsAttestedByUserId", "rightsAttestedAt",
    "artifact", "width", "height", "createdAt",
  ],
  {
    id: text("uuid"), projectId: text("uuid"), bibleId: text("uuid"),
    sourceVersionId: text("uuid"),
    role: { type: "string", enum: ["identity-primary"] },
    canonicalView: { type: "string", enum: ["frontal"] },
    rightsClassification: {
      type: "string",
      enum: ["owned-by-user", "user-provided-private-reference"],
    },
    rightsAttestedByUserId: text("uuid"), rightsAttestedAt: text("date-time"),
    artifact: characterArtifactSchema, width: integer, height: integer,
    createdAt: text("date-time"),
  },
);
const characterJobSchema = objectSchema(
  [
    "id", "projectId", "type", "status", "operationKey", "requestHash",
    "payload", "attempt", "maxAttempts", "nextAttemptAt", "leaseOwner",
    "leaseExpiresAt", "errorCode", "createdAt", "updatedAt",
  ],
  {
    id: text("uuid"), projectId: text("uuid"), type: text(), status: text(),
    operationKey: text(), requestHash: text(),
    payload: { type: "object", additionalProperties: true },
    attempt: integer, maxAttempts: integer, nextAttemptAt: text("date-time"),
    leaseOwner: nullableText, leaseExpiresAt: nullableText, errorCode: nullableText,
    createdAt: text("date-time"), updatedAt: text("date-time"),
  },
);
const characterRigSchema = objectSchema(
  [
    "schemaVersion", "id", "projectId", "bibleId", "version", "status",
    "pipeline", "failureCode", "sourceFingerprint", "source", "canvas",
    "nodes", "psdArtifact", "manifestArtifact", "approvedByUserId",
    "approvedAt", "createdAt", "updatedAt",
  ],
  {
    schemaVersion: { type: "string", const: "1.0" }, id: text("uuid"),
    projectId: text("uuid"), bibleId: text("uuid"), version: integer, status: text(),
    pipeline: { type: "string", enum: ["source-preserving"] },
    failureCode: nullableText,
    sourceFingerprint: text(), canvas: { type: "object", additionalProperties: false,
      required: ["width", "height"], properties: { width: integer, height: integer } },
    source: { type: "object", additionalProperties: true },
    nodes: { type: "array", items: { type: "object", additionalProperties: true } },
    psdArtifact: { anyOf: [characterArtifactSchema, { type: "null" }] },
    manifestArtifact: { anyOf: [characterArtifactSchema, { type: "null" }] },
    approvedByUserId: nullableText, approvedAt: nullableText,
    createdAt: text("date-time"), updatedAt: text("date-time"),
  },
);
export const characterStateSchema = objectSchema(
  ["bible", "references", "rig", "jobs"],
  {
    bible: { anyOf: [characterBibleSchema, { type: "null" }] },
    references: arrayOf(characterReferenceSchema),
    rig: { anyOf: [characterRigSchema, { type: "null" }] },
    jobs: arrayOf(characterJobSchema),
  },
);
export const rigQueueSchema = objectSchema(["rig", "job", "replayed"], {
  rig: characterRigSchema,
  job: characterJobSchema,
  replayed: { type: "boolean" },
});
export const rigReviewSchema = objectSchema(["rig", "review", "replayed"], {
  rig: characterRigSchema,
  review: { type: "object", additionalProperties: true },
  replayed: { type: "boolean" },
});
