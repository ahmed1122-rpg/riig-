import {
  integer,
  number,
  objectSchema as objectBody,
  stringArray,
  text,
} from "../http/openapi-schema-builders.js";

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
        role: { type: "string", enum: ["identity-primary"] },
        canonicalView: { type: "string", enum: ["frontal"] },
        rightsClassification: {
          type: "string",
          enum: [
            "owned-by-user",
            "user-provided-private-reference",
          ],
        },
      },
    ),
  ],
  [
    "POST /v1/projects/:projectId/character-rig/compile",
    objectBody(["bibleId", "sourceVersionId", "width", "height"], {
      bibleId: text("uuid"),
      sourceVersionId: text("uuid"),
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
