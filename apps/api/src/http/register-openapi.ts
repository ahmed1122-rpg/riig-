import swagger from "@fastify/swagger";
import type { FastifyInstance } from "fastify";
import {
  registerOpenApiDefaults,
  transformOpenApiDocumentation,
} from "./openapi-defaults.js";

export async function registerOpenApi(
  app: FastifyInstance,
  options: { applicationVersion: string; webOrigin: string },
): Promise<void> {
  await app.register(swagger, {
    transform: transformOpenApiDocumentation,
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "MotionPrep Studio API",
        description:
          "HTTP API for authentication, source preparation, layered editing, exports, billing, and administration.",
        version: options.applicationVersion,
      },
      servers: [{ url: new URL(options.webOrigin).origin }],
      tags: [
        { name: "health" },
        { name: "auth" },
        { name: "account" },
        { name: "projects" },
        { name: "uploads" },
        { name: "processing" },
        { name: "character-rig" },
        { name: "exports" },
        { name: "billing" },
        { name: "admin" },
        { name: "system" },
      ],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: "motionprep_session",
          },
          providerSignature: {
            type: "apiKey",
            in: "header",
            name: "stripe-signature",
          },
        },
        schemas: {
          ApiErrorEnvelope: {
            type: "object",
            required: ["data", "error"],
            properties: {
              data: { type: "null" },
              error: {
                type: "object",
                required: ["code", "message", "requestId"],
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
          },
        },
        responses: Object.fromEntries(
          [
            ["BadRequest", "The request is invalid."],
            ["Unauthorized", "Authentication is required."],
            ["Forbidden", "The authenticated user is not authorized."],
            ["Conflict", "The request conflicts with current state."],
            ["RateLimited", "The request rate limit was exceeded."],
            ["InternalError", "An unexpected server error occurred."],
          ].map(([name, description]) => [
            name,
            {
              description,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                },
              },
            },
          ]),
        ),
      },
    },
  });
  registerOpenApiDefaults(app);
}
