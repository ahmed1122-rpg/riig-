import type {
  FastifyInstance,
  FastifySchema,
  RouteOptions,
} from "fastify";
import { documentedSuccessResponses } from "./openapi-success-responses.js";
import {
  characterDocumentedBodies,
  characterRouteSummaries,
} from "../character-rig/character-rig-openapi.js";
import {
  boolean,
  integer,
  number,
  objectSchema as objectBody,
  stringArray,
  text,
} from "./openapi-schema-builders.js";

interface OpenApiSchema extends FastifySchema {
  hide?: boolean;
  security?: Array<Record<string, string[]>>;
  summary?: string;
  tags?: string[];
}

const publicPaths = new Set([
  "/v1/health",
  "/v1/health/live",
  "/v1/health/ready",
  "/v1/capabilities",
  "/v1/auth/register",
  "/v1/auth/login",
  "/v1/auth/mfa/challenge",
  "/v1/auth/password-reset/request",
  "/v1/auth/password-reset/confirm",
]);

const apiErrorSchema = {
  type: "object",
  required: ["data", "error"],
  properties: {
    data: { type: "null" },
    error: {
      type: "object",
      required: ["code", "message"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        requestId: { type: "string" },
        fields: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
    },
  },
};

const standardErrorResponses = Object.fromEntries(
  [400, 401, 403, 409, 429, 500].map((status) => [
    status,
    { ...apiErrorSchema, description: `HTTP ${status} API error envelope` },
  ]),
);

export function registerOpenApiDefaults(app: FastifyInstance): void {
  app.addHook("onRoute", (route) => {
    if (route.url.startsWith("/internal/")) {
      route.schema = { ...(route.schema ?? {}), hide: true };
      return;
    }
    if (!route.url.startsWith("/v1/") || route.url === "/v1/openapi.json") {
      return;
    }
    const schema = (route.schema ?? {}) as OpenApiSchema;
    const method = Array.isArray(route.method)
      ? route.method.join("/")
      : route.method;
    schema.summary ??= `${method} ${route.url}`;
    schema.tags ??= [tagFor(route.url)];
    schema.response = {
      ...standardErrorResponses,
      ...(schema.response ?? {}),
    };
    if (schema.security === undefined) {
      schema.security = route.url.includes("/billing/webhooks/")
        ? [{ providerSignature: [] }]
        : publicPaths.has(route.url)
          ? []
          : [{ sessionCookie: [] }];
    }
    route.schema = schema;
  });
}

export function transformOpenApiDocumentation({
  schema,
  url,
  route,
}: {
  schema: FastifySchema;
  url: string;
  route: RouteOptions;
}): { schema: FastifySchema; url: string } {
  const method = Array.isArray(route.method)
    ? route.method[0]
    : route.method;
  const routeKey = `${method} ${url}`;
  const body = documentedBodies.get(routeKey);
  const successResponses = documentedSuccessResponses.get(routeKey);
  const characterSummary = characterRouteSummaries.get(routeKey);
  const params = pathParameters(url);
  return {
    url,
    schema: {
      ...schema,
      ...(body && !schema.body ? { body } : {}),
      ...(characterSummary
        ? { summary: characterSummary, tags: ["character-rig"] }
        : {}),
      ...(params && !schema.params ? { params } : {}),
      ...(successResponses
        ? {
            response: {
              ...(schema.response ?? {}),
              ...successResponses,
            },
          }
        : {}),
      ...(url === "/v1/uploads/:uploadId/content"
        ? { consumes: ["application/octet-stream"] }
        : {}),
    },
  };
}

function tagFor(url: string): string {
  if (url.startsWith("/v1/health")) return "health";
  const segment = url.split("/")[2];
  return segment === "capabilities" ? "system" : segment ?? "system";
}

function pathParameters(url: string): Record<string, unknown> | undefined {
  const names = [...url.matchAll(/:([A-Za-z][A-Za-z0-9_]*)/gu)].map(
    (match) => match[1]!,
  );
  if (names.length === 0) return undefined;
  return {
    type: "object",
    required: names,
    properties: Object.fromEntries(
      names.map((name) => [
        name,
        name === "providerId"
          ? { type: "string", enum: ["stripe"] }
          : { type: "string", format: "uuid" },
      ]),
    ),
  };
}

const documentedBodies = new Map<string, Record<string, unknown>>([
  [
    "POST /v1/auth/register",
    objectBody(["name", "email", "password", "legal"], {
      name: text(),
      email: text("email"),
      password: text("password"),
      legal: objectBody(["accepted", "termsVersion", "privacyVersion"], {
        accepted: { type: "boolean", const: true },
        termsVersion: text(),
        privacyVersion: text(),
      }),
    }),
  ],
  [
    "DELETE /v1/account",
    objectBody(["password", "confirmation"], {
      password: text("password"),
      confirmation: { type: "string", const: "DELETE" },
    }),
  ],
  [
    "POST /v1/auth/login",
    objectBody(["email", "password"], {
      email: text("email"),
      password: text("password"),
    }),
  ],
  [
    "POST /v1/auth/mfa/challenge",
    objectBody(["challengeToken", "code"], {
      challengeToken: text(),
      code: text(),
    }),
  ],
  [
    "POST /v1/auth/mfa/setup/confirm",
    objectBody(["setupToken", "code"], {
      setupToken: text(),
      code: text(),
    }),
  ],
  [
    "POST /v1/auth/mfa/disable",
    objectBody(["password", "code"], {
      password: text("password"),
      code: text(),
    }),
  ],
  [
    "POST /v1/auth/password-reset/request",
    objectBody(["email"], { email: text("email") }),
  ],
  [
    "POST /v1/auth/password-reset/confirm",
    objectBody(["token", "newPassword"], {
      token: text(),
      newPassword: text("password"),
    }),
  ],
  [
    "POST /v1/auth/password/change",
    objectBody(["currentPassword", "newPassword"], {
      currentPassword: text("password"),
      newPassword: text("password"),
    }),
  ],
  [
    "POST /v1/projects",
    objectBody(["name", "kind"], {
      name: text(),
      kind: { type: "string", enum: ["image", "book"] },
    }),
  ],
  [
    "POST /v1/projects/:projectId/source-versions/:versionId/restore",
    objectBody(["expectedCurrentSourceVersionId", "reason"], {
      expectedCurrentSourceVersionId: text("uuid"),
      reason: text(),
    }),
  ],
  [
    "POST /v1/projects/:projectId/review/approve",
    objectBody(["sourceVersionId", "documentRevision"], {
      sourceVersionId: text("uuid"),
      documentRevision: integer,
    }),
  ],
  [
    "POST /v1/uploads/intents",
    objectBody(["projectId", "filename", "contentType", "sizeBytes"], {
      projectId: text("uuid"),
      filename: text(),
      contentType: text(),
      sizeBytes: integer,
      replaceSourceVersion: boolean,
    }),
  ],
  ["PUT /v1/uploads/:uploadId/content", { type: "string", format: "binary" }],
  [
    "POST /v1/processing/jobs",
    objectBody(["projectId", "sourceVersionId"], {
      projectId: text("uuid"),
      sourceVersionId: text("uuid"),
      pdfSeparationMode: text(),
    }),
  ],
  [
    "PATCH /v1/projects/:projectId/layer-document",
    objectBody(["sourceVersionId", "baseRevision", "layers"], {
      sourceVersionId: text("uuid"),
      baseRevision: integer,
      layers: { type: "array", items: { type: "object" } },
    }),
  ],
  [
    "POST /v1/projects/:projectId/layer-document/commands",
    objectBody(["sourceVersionId", "baseRevision", "command"], {
      sourceVersionId: text("uuid"),
      baseRevision: integer,
      command: { type: "object", additionalProperties: true },
    }),
  ],
  [
    "POST /v1/projects/:projectId/guided-refinements",
    objectBody(["sourceVersionId", "baseRevision", "mode"], {
      sourceVersionId: text("uuid"),
      baseRevision: integer,
      mode: { type: "string", enum: ["automatic", "manual", "guided"] },
      imageStrokes: { type: "array", items: { type: "object" } },
      pdfRegions: { type: "array", items: { type: "object" } },
    }),
  ],
  [
    "POST /v1/projects/:projectId/layer-document/text/region-ocr",
    objectBody(
      ["sourceVersionId", "baseRevision", "pageNumber", "start", "end"],
      {
        sourceVersionId: text("uuid"),
        baseRevision: integer,
        pageNumber: integer,
        start: { type: "object" },
        end: { type: "object" },
      },
    ),
  ],
  [
    "POST /v1/projects/:projectId/layer-document/text/split",
    objectBody(["sourceVersionId", "baseRevision", "layerId", "offset"], {
      sourceVersionId: text("uuid"),
      baseRevision: integer,
      layerId: text("uuid"),
      offset: integer,
    }),
  ],
  [
    "POST /v1/projects/:projectId/layer-document/text/merge",
    objectBody(["sourceVersionId", "baseRevision", "layerIds", "separator"], {
      sourceVersionId: text("uuid"),
      baseRevision: integer,
      layerIds: stringArray,
      separator: { type: "string", enum: ["space", "newline"] },
    }),
  ],
  [
    "POST /v1/projects/:projectId/layer-document/history",
    objectBody(["sourceVersionId", "baseRevision", "direction"], {
      sourceVersionId: text("uuid"),
      baseRevision: integer,
      direction: { type: "string", enum: ["undo", "redo"] },
    }),
  ],
  [
    "POST /v1/projects/:projectId/layer-document/image/refine-edges",
    objectBody(
      ["sourceVersionId", "baseRevision", "layerId", "radius", "strength"],
      {
        sourceVersionId: text("uuid"),
        baseRevision: integer,
        layerId: text("uuid"),
        radius: integer,
        strength: number,
      },
    ),
  ],
  [
    "POST /v1/projects/:projectId/layer-document/image/merge",
    objectBody(["sourceVersionId", "baseRevision", "layerIds"], {
      sourceVersionId: text("uuid"),
      baseRevision: integer,
      layerIds: stringArray,
    }),
  ],
  [
    "POST /v1/exports",
    objectBody(["projectId", "sourceVersionId", "format", "scope", "scale", "colorProfile", "namingPresetId"], {
      projectId: text("uuid"),
      sourceVersionId: text("uuid"),
      documentRevision: integer,
      format: text(),
      scope: text(),
      selectedPage: integer,
      scale: integer,
      colorProfile: text(),
      namingPresetId: text(),
    }),
  ],
  [
    "POST /v1/billing/checkouts",
    objectBody(["providerId", "planId", "currency", "returnUrl"], {
      providerId: {
        type: "string",
        enum: ["sandbox-card", "sandbox-local", "stripe"],
      },
      planId: { type: "string", enum: ["creator", "studio"] },
      currency: { type: "string", enum: ["USD", "EGP"] },
      returnUrl: text("uri"),
    }),
  ],
  [
    "POST /v1/billing/portal",
    objectBody(["returnUrl"], { returnUrl: text("uri") }),
  ],
  [
    "POST /v1/admin/processing/:jobId/retry",
    objectBody(["reason"], { reason: text() }),
  ],
  [
    "POST /v1/admin/exports/:jobId/retry",
    objectBody(["reason"], { reason: text() }),
  ],
  [
    "PATCH /v1/admin/users/:userId/access",
    objectBody(["reason"], {
      status: {
        type: "string",
        enum: ["active", "suspended", "pending_verification"],
      },
      role: {
        type: "string",
        enum: ["creator", "support", "finance", "admin"],
      },
      reason: text(),
    }),
  ],
  ...characterDocumentedBodies,
]);
