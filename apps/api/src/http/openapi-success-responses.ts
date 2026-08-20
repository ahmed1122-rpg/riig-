import {
  integer,
  objectSchema,
  text,
} from "./openapi-schema-builders.js";
import {
  characterBibleSchema,
  characterReferenceSchema,
  characterReviewSchema,
  characterStateSchema,
  generationQueueSchema,
  identityQueueSchema,
  rigQueueSchema,
  rigReviewSchema,
} from "./openapi-character-schemas.js";

const nullableText = { type: ["string", "null"] };
const nullableInteger = { type: ["integer", "null"] };

const workflowActivityItemSchema = objectSchema(
  [
    "id",
    "kind",
    "status",
    "project",
    "sourceVersionId",
    "jobId",
    "progress",
    "errorCode",
    "recommendedAction",
    "createdAt",
    "updatedAt",
  ],
  {
    id: text(),
    kind: {
      type: "string",
      enum: ["upload", "processing", "review", "export"],
    },
    status: {
      type: "string",
      enum: [
        "pending",
        "running",
        "attention",
        "succeeded",
        "failed",
        "cancelled",
      ],
    },
    project: objectSchema(["id", "name", "kind"], {
      id: text("uuid"),
      name: text(),
      kind: { type: "string", enum: ["image", "book"] },
    }),
    sourceVersionId: nullableText,
    jobId: nullableText,
    progress: nullableInteger,
    errorCode: nullableText,
    recommendedAction: {
      type: "string",
      enum: ["open-project", "review-project", "view-exports"],
    },
    createdAt: text("date-time"),
    updatedAt: text("date-time"),
  },
);

const workflowActivityFeedSchema = objectSchema(
  ["items", "summary", "nextCursor", "generatedAt"],
  {
    items: { type: "array", items: workflowActivityItemSchema },
    summary: objectSchema(["active", "needsAttention", "failed"], {
      active: integer,
      needsAttention: integer,
      failed: integer,
    }),
    nextCursor: nullableText,
    generatedAt: text("date-time"),
  },
);

const exportArtifactDtoSchema = objectSchema(
  ["filename", "sizeBytes", "sha256", "expiresAt"],
  {
    filename: text(),
    sizeBytes: integer,
    sha256: text(),
    expiresAt: text("date-time"),
  },
);

const exportJobDtoProperties = {
  id: text("uuid"),
  projectId: text("uuid"),
  sourceVersionId: text("uuid"),
  documentRevision: integer,
  projectKind: { type: "string", enum: ["image", "book"] },
  format: text(),
  scope: text(),
  selectedPage: nullableInteger,
  scale: integer,
  colorProfile: text(),
  namingPresetId: text(),
  status: text(),
  progress: integer,
  attempt: integer,
  maxAttempts: integer,
  errorCode: nullableText,
  createdAt: text("date-time"),
  updatedAt: text("date-time"),
  artifact: exportArtifactDtoSchema,
};

const exportJobDtoRequired = [
  "id",
  "projectId",
  "sourceVersionId",
  "documentRevision",
  "projectKind",
  "format",
  "scope",
  "scale",
  "colorProfile",
  "namingPresetId",
  "status",
  "progress",
  "attempt",
  "maxAttempts",
  "errorCode",
  "createdAt",
  "updatedAt",
];

const exportJobDtoSchema = objectSchema(
  exportJobDtoRequired,
  exportJobDtoProperties,
);

const processingJobDtoProperties = {
  id: text("uuid"),
  projectId: text("uuid"),
  sourceVersionId: text("uuid"),
  projectKind: { type: "string", enum: ["image", "book"] },
  options: { type: "object", additionalProperties: true },
  status: text(),
  progress: integer,
  attempt: integer,
  maxAttempts: integer,
  errorCode: nullableText,
  createdAt: text("date-time"),
  updatedAt: text("date-time"),
};

const processingJobDtoRequired = Object.keys(processingJobDtoProperties);
const processingJobDtoSchema = objectSchema(
  processingJobDtoRequired,
  processingJobDtoProperties,
);

const adminOperationsProperties = {
  correlationId: nullableText,
  traceId: nullableText,
  attempt: objectSchema(["current", "maximum", "nextAt"], {
    current: integer,
    maximum: integer,
    nextAt: text("date-time"),
  }),
  error: {
    anyOf: [objectSchema(["code"], { code: text() }), { type: "null" }],
  },
  lease: {
    anyOf: [
      objectSchema(["owner", "expiresAt"], {
        owner: nullableText,
        expiresAt: nullableText,
      }),
      { type: "null" },
    ],
  },
};

const adminOperationRequired = Object.keys(adminOperationsProperties);
const publicQueueFieldNames = new Set(["attempt", "maxAttempts", "errorCode"]);
const adminExportJobDtoProperties = withoutPublicQueueFields(
  exportJobDtoProperties,
);
const adminProcessingJobDtoProperties = withoutPublicQueueFields(
  processingJobDtoProperties,
);
const adminExportJobDtoSchema = objectSchema(
  [
    ...exportJobDtoRequired.filter(
      (field) => !publicQueueFieldNames.has(field),
    ),
    ...adminOperationRequired,
  ],
  {
    ...adminExportJobDtoProperties,
    ...adminOperationsProperties,
  },
);
const adminProcessingJobDtoSchema = objectSchema(
  [
    ...processingJobDtoRequired.filter(
      (field) => !publicQueueFieldNames.has(field),
    ),
    ...adminOperationRequired,
  ],
  {
    ...adminProcessingJobDtoProperties,
    ...adminOperationsProperties,
  },
);

function withoutPublicQueueFields(properties: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(properties).filter(
      ([field]) => !publicQueueFieldNames.has(field),
    ),
  );
}

function successEnvelope(data: Record<string, unknown>, description: string) {
  return {
    ...objectSchema(["data", "error"], {
      data,
      error: { type: "null" },
    }),
    description,
  };
}

function arrayOf(items: Record<string, unknown>) {
  return { type: "array", items };
}

export const documentedSuccessResponses = new Map<
  string,
  Record<number, Record<string, unknown>>
>([
  [
    "GET /v1/activity",
    {
      200: successEnvelope(
        workflowActivityFeedSchema,
        "Creator workflow activity",
      ),
    },
  ],
  [
    "GET /v1/exports",
    { 200: successEnvelope(arrayOf(exportJobDtoSchema), "Export jobs") },
  ],
  [
    "POST /v1/exports",
    { 202: successEnvelope(exportJobDtoSchema, "Accepted export job") },
  ],
  [
    "GET /v1/exports/:exportId",
    { 200: successEnvelope(exportJobDtoSchema, "Export job") },
  ],
  [
    "POST /v1/exports/:exportId/cancel",
    { 200: successEnvelope(exportJobDtoSchema, "Cancelled export job") },
  ],
  [
    "POST /v1/processing/jobs",
    { 202: successEnvelope(processingJobDtoSchema, "Accepted processing job") },
  ],
  [
    "GET /v1/processing/jobs/:jobId",
    { 200: successEnvelope(processingJobDtoSchema, "Processing job") },
  ],
  [
    "POST /v1/projects/:projectId/layer-document/text/region-ocr",
    { 202: successEnvelope(processingJobDtoSchema, "Accepted OCR job") },
  ],
  [
    "GET /v1/admin/processing",
    {
      200: successEnvelope(
        arrayOf(adminProcessingJobDtoSchema),
        "Administrative processing jobs",
      ),
    },
  ],
  [
    "POST /v1/admin/processing/:jobId/retry",
    {
      200: successEnvelope(
        adminProcessingJobDtoSchema,
        "Retried processing job",
      ),
    },
  ],
  [
    "GET /v1/admin/exports",
    {
      200: successEnvelope(
        arrayOf(adminExportJobDtoSchema),
        "Administrative export jobs",
      ),
    },
  ],
  [
    "POST /v1/admin/exports/:jobId/retry",
    {
      200: successEnvelope(adminExportJobDtoSchema, "Retried export job"),
    },
  ],
  [
    "GET /v1/projects/:projectId/character-rig",
    { 200: successEnvelope(characterStateSchema, "Character Rig workspace state") },
  ],
  [
    "PUT /v1/projects/:projectId/character-rig/bible",
    { 200: successEnvelope(characterBibleSchema, "Saved Character Bible") },
  ],
  [
    "POST /v1/projects/:projectId/character-rig/bible/approve",
    { 200: successEnvelope(characterBibleSchema, "Approved Character Bible") },
  ],
  [
    "POST /v1/projects/:projectId/character-rig/references/current-source",
    { 201: successEnvelope(characterReferenceSchema, "Created Character reference") },
  ],
  [
    "POST /v1/projects/:projectId/character-rig/identity-model",
    {
      200: successEnvelope(identityQueueSchema, "Replayed identity training"),
      202: successEnvelope(identityQueueSchema, "Accepted identity training"),
    },
  ],
  [
    "POST /v1/projects/:projectId/character-rig/generations",
    {
      200: successEnvelope(generationQueueSchema, "Replayed Character generation"),
      202: successEnvelope(generationQueueSchema, "Accepted Character generation"),
    },
  ],
  [
    "POST /v1/projects/:projectId/character-rig/generations/:generationAttemptId/reviews",
    {
      200: successEnvelope(characterReviewSchema, "Replayed Character review"),
      201: successEnvelope(characterReviewSchema, "Created Character review"),
    },
  ],
  [
    "GET /v1/projects/:projectId/character-rig/generations/:generationAttemptId/artifact",
    { 200: { type: "string", format: "binary", description: "Verified PNG artifact" } },
  ],
  [
    "POST /v1/projects/:projectId/character-rig/compile",
    {
      200: successEnvelope(rigQueueSchema, "Replayed rig compilation"),
      202: successEnvelope(rigQueueSchema, "Accepted rig compilation"),
    },
  ],
  [
    "GET /v1/projects/:projectId/character-rig/rigs/:rigVersionId/artifacts/:artifactType",
    { 200: { type: "string", format: "binary", description: "Verified PSD or manifest" } },
  ],
  [
    "POST /v1/projects/:projectId/character-rig/rigs/:rigVersionId/reviews",
    {
      200: successEnvelope(rigReviewSchema, "Replayed Character Rig review"),
      201: successEnvelope(rigReviewSchema, "Created Character Rig review"),
    },
  ],
]);
