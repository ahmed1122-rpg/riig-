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
    "id", "projectId", "bibleId", "role", "canonicalView",
    "rightsClassification", "rightsAttestedByUserId", "rightsAttestedAt",
    "artifact", "width", "height", "createdAt",
  ],
  {
    id: text("uuid"), projectId: text("uuid"), bibleId: text("uuid"),
    role: text(), canonicalView: nullableText, rightsClassification: text(),
    rightsAttestedByUserId: text("uuid"), rightsAttestedAt: text("date-time"),
    artifact: characterArtifactSchema, width: integer, height: integer,
    createdAt: text("date-time"),
  },
);
const characterIdentityModelSchema = objectSchema(
  [
    "id", "projectId", "bibleId", "version", "status", "providerKey",
    "providerModelReference", "baseModelReference", "datasetFingerprint",
    "trainingConfiguration", "failureCode", "createdAt", "updatedAt",
  ],
  {
    id: text("uuid"), projectId: text("uuid"), bibleId: text("uuid"), version: integer,
    status: text(), providerKey: text(), providerModelReference: nullableText,
    baseModelReference: text(), datasetFingerprint: text(),
    trainingConfiguration: { type: "object", additionalProperties: true },
    trainingMetrics: { type: "object", additionalProperties: { type: "number" } },
    failureCode: nullableText, createdAt: text("date-time"), updatedAt: text("date-time"),
  },
);
const characterGenerationSchema = objectSchema(
  [
    "id", "projectId", "bibleId", "identityModelVersionId", "target",
    "status", "controls", "requestHash", "idempotencyKey", "outputArtifact",
    "outputGeometry", "qualityReport", "failureCode", "createdByUserId", "createdAt", "updatedAt",
  ],
  {
    id: text("uuid"), projectId: text("uuid"), bibleId: text("uuid"),
    identityModelVersionId: text("uuid"), target: { type: "object", additionalProperties: true },
    status: text(), controls: { type: "object", additionalProperties: true },
    requestHash: text(), idempotencyKey: text(),
    outputArtifact: { anyOf: [characterArtifactSchema, { type: "null" }] },
    outputGeometry: {
      anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }],
    },
    qualityReport: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
    failureCode: nullableText, createdByUserId: text("uuid"),
    createdAt: text("date-time"), updatedAt: text("date-time"),
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
    "nodes", "psdArtifact", "manifestArtifact", "approvedByUserId",
    "approvedAt", "createdAt", "updatedAt",
  ],
  {
    schemaVersion: { type: "string", const: "1.0" }, id: text("uuid"),
    projectId: text("uuid"), bibleId: text("uuid"), version: integer, status: text(),
    sourceFingerprint: text(), canvas: { type: "object", additionalProperties: false,
      required: ["width", "height"], properties: { width: integer, height: integer } },
    nodes: { type: "array", items: { type: "object", additionalProperties: true } },
    psdArtifact: { anyOf: [characterArtifactSchema, { type: "null" }] },
    manifestArtifact: { anyOf: [characterArtifactSchema, { type: "null" }] },
    approvedByUserId: nullableText, approvedAt: nullableText,
    createdAt: text("date-time"), updatedAt: text("date-time"),
  },
);
export const characterStateSchema = objectSchema(
  ["bible", "references", "identityModel", "generations", "rig", "jobs"],
  {
    bible: { anyOf: [characterBibleSchema, { type: "null" }] },
    references: arrayOf(characterReferenceSchema),
    identityModel: { anyOf: [characterIdentityModelSchema, { type: "null" }] },
    generations: arrayOf(characterGenerationSchema),
    rig: { anyOf: [characterRigSchema, { type: "null" }] },
    jobs: arrayOf(characterJobSchema),
  },
);
export const identityQueueSchema = objectSchema(["modelVersion", "job"], {
  modelVersion: characterIdentityModelSchema,
  job: characterJobSchema,
});
export const generationQueueSchema = objectSchema(["attempt", "job", "replayed"], {
  attempt: characterGenerationSchema,
  job: characterJobSchema,
  replayed: { type: "boolean" },
});
export const characterReviewSchema = objectSchema(
  ["attempt", "review", "replayed"],
  {
    attempt: characterGenerationSchema,
    review: { type: "object", additionalProperties: true },
    replayed: { type: "boolean" },
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
