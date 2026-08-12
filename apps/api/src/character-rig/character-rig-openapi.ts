import {
  integer,
  number,
  objectSchema as objectBody,
  stringArray,
  text,
} from "../http/openapi-schema-builders.js";

const characterCanonicalViews = [
  "frontal",
  "left-quarter",
  "left-profile",
  "right-quarter",
  "right-profile",
];
const characterReferenceRoles = [
  "identity-primary",
  "canonical-view",
  "body-proportion",
  "style-material",
  "part-mask",
  "pose-control",
  "depth-control",
];
const nullableUuid = {
  anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
};

export const characterDocumentedBodies = new Map<
  string,
  Record<string, unknown>
>([
  [
    "PUT /v1/projects/:projectId/character-rig/bible",
    objectBody(
      [
        "bibleId",
        "expectedRevision",
        "displayName",
        "identityDescription",
        "negativeConstraints",
        "distinguishingFeatures",
        "proportions",
        "palette",
        "materials",
      ],
      {
        bibleId: { type: ["string", "null"], format: "uuid" },
        expectedRevision: { type: ["integer", "null"], minimum: 1 },
        displayName: text(),
        identityDescription: text(),
        negativeConstraints: stringArray,
        distinguishingFeatures: stringArray,
        proportions: objectBody(
          [
            "headToBodyHeightRatio",
            "shoulderToBodyHeightRatio",
            "eyeSpacingToFaceWidthRatio",
            "notes",
          ],
          {
            headToBodyHeightRatio: number,
            shoulderToBodyHeightRatio: number,
            eyeSpacingToFaceWidthRatio: number,
            notes: stringArray,
          },
        ),
        palette: { type: "array", items: { type: "object" } },
        materials: { type: "array", items: { type: "object" } },
      },
    ),
  ],
  [
    "POST /v1/projects/:projectId/character-rig/bible/approve",
    objectBody(["bibleId", "expectedRevision"], {
      bibleId: text("uuid"),
      expectedRevision: integer,
    }),
  ],
  [
    "POST /v1/projects/:projectId/character-rig/references/current-source",
    objectBody(
      [
        "bibleId",
        "sourceVersionId",
        "role",
        "canonicalView",
        "rightsClassification",
      ],
      {
        bibleId: text("uuid"),
        sourceVersionId: text("uuid"),
        role: { type: "string", enum: characterReferenceRoles },
        canonicalView: {
          anyOf: [
            { type: "string", enum: characterCanonicalViews },
            { type: "null" },
          ],
        },
        rightsClassification: {
          type: "string",
          enum: [
            "owned-by-user",
            "licensed-for-model-use",
            "user-provided-private-reference",
          ],
        },
      },
    ),
  ],
  [
    "POST /v1/projects/:projectId/character-rig/identity-model",
    objectBody(["bibleId"], { bibleId: text("uuid") }),
  ],
  [
    "POST /v1/projects/:projectId/character-rig/generations",
    objectBody(
      ["bibleId", "identityModelVersionId", "target", "controls"],
      {
        bibleId: text("uuid"),
        identityModelVersionId: text("uuid"),
        target: {
          type: "object",
          required: ["kind", "view"],
          properties: {
            kind: {
              type: "string",
              enum: ["canonical-view", "part", "masked-repair"],
            },
            view: { type: "string", enum: characterCanonicalViews },
            partName: text(),
          },
        },
        controls: objectBody(
          [
            "seed",
            "canvas",
            "poseReferenceId",
            "depthReferenceId",
            "maskReferenceId",
            "parameters",
          ],
          {
            seed: integer,
            canvas: objectBody(["width", "height"], {
              width: integer,
              height: integer,
            }),
            poseReferenceId: nullableUuid,
            depthReferenceId: nullableUuid,
            maskReferenceId: nullableUuid,
            parameters: {
              type: "object",
              additionalProperties: {
                anyOf: [
                  { type: "string" },
                  { type: "number" },
                  { type: "boolean" },
                ],
              },
            },
          },
        ),
      },
    ),
  ],
  [
    "POST /v1/projects/:projectId/character-rig/generations/:generationAttemptId/reviews",
    objectBody(["decision", "reason"], {
      decision: {
        type: "string",
        enum: ["approved", "rejected", "changes-requested"],
      },
      reason: text(),
    }),
  ],
  [
    "POST /v1/projects/:projectId/character-rig/compile",
    objectBody(["bibleId", "width", "height"], {
      bibleId: text("uuid"),
      width: integer,
      height: integer,
    }),
  ],
  [
    "POST /v1/projects/:projectId/character-rig/rigs/:rigVersionId/reviews",
    objectBody(["decision", "reason"], {
      decision: { type: "string", enum: ["approved", "rejected"] },
      reason: text(),
    }),
  ],
]);

export const characterRouteSummaries = new Map([
  [
    "GET /v1/projects/:projectId/character-rig",
    "Read Character Rig workspace state",
  ],
  [
    "PUT /v1/projects/:projectId/character-rig/bible",
    "Create or revise a Character Bible",
  ],
  [
    "POST /v1/projects/:projectId/character-rig/bible/approve",
    "Approve a Character Bible revision",
  ],
  [
    "POST /v1/projects/:projectId/character-rig/references/current-source",
    "Attach the current source as a Character reference",
  ],
  [
    "POST /v1/projects/:projectId/character-rig/identity-model",
    "Queue identity-model training",
  ],
  [
    "POST /v1/projects/:projectId/character-rig/generations",
    "Queue an identity-locked generation",
  ],
  [
    "POST /v1/projects/:projectId/character-rig/generations/:generationAttemptId/reviews",
    "Review a generated Character artifact",
  ],
  [
    "GET /v1/projects/:projectId/character-rig/generations/:generationAttemptId/artifact",
    "Download a verified Character artifact",
  ],
  [
    "POST /v1/projects/:projectId/character-rig/compile",
    "Queue Character Rig PSD compilation",
  ],
  [
    "GET /v1/projects/:projectId/character-rig/rigs/:rigVersionId/artifacts/:artifactType",
    "Download a verified Character Rig artifact",
  ],
  [
    "POST /v1/projects/:projectId/character-rig/rigs/:rigVersionId/reviews",
    "Approve or reject a compiled Character Rig",
  ],
]);
