import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/authorize.js";
import type { AuthService } from "../auth/auth-service.js";
import { trySendAuthDomainError } from "../auth/auth-route-error.js";
import {
  sendApiError,
  sendProjectNotFound,
} from "../http/api-response.js";
import type { ProjectRepository } from "./project-repository.js";
import type { SourceVersionRepository } from "../sources/source-version-repository.js";
import {
  SourceVersionRestoreDomainError,
  type SourceVersionRestoreCommand,
} from "../sources/source-version-restore.js";
import { createDomainErrorResponder } from "../http/domain-route-error.js";

const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["image", "book"]),
});
const restoreParamsSchema = z.object({
  projectId: z.string().uuid(),
  versionId: z.string().uuid(),
});
const restoreSourceVersionSchema = z.object({
  expectedCurrentSourceVersionId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});
const restoreHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export async function registerProjectRoutes(
  app: FastifyInstance,
  repository: ProjectRepository,
  auth: AuthService,
  sourceVersions: SourceVersionRepository,
  sourceVersionRestores: SourceVersionRestoreCommand,
): Promise<void> {
  app.get("/v1/projects", async (request, reply) => {
    try {
      const user = await requireUser(request, auth);
      return {
        data: await repository.listOwnedByUser(user.id),
        error: null,
      };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.get("/v1/projects/:projectId/source-versions", async (request, reply) => {
    try {
      const user = await requireUser(request, auth);
      const projectId = z.string().uuid().safeParse(
        (request.params as { projectId?: unknown }).projectId,
      );
      if (!projectId.success) return reply.status(404).send();
      const project = await repository.findOwnedById(user.id, projectId.data);
      if (!project) {
        return sendProjectNotFound(reply, request.id);
      }
      return {
        data: await sourceVersions.listByProject(project.id),
        error: null,
      };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/projects", async (request, reply) => {
    try {
      const user = await requireUser(request, auth);
      const parsed = createProjectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          data: null,
          error: {
            code: "VALIDATION_FAILED",
            message: "بيانات المشروع غير صالحة.",
            fields: parsed.error.flatten().fieldErrors,
            requestId: request.id,
          },
        });
      }

      const project = await repository.create(user.id, parsed.data);
      return reply.status(201).send({ data: project, error: null });
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.get(
    "/v1/projects/:projectId/source-version-restores",
    async (request, reply) => {
      try {
        const user = await requireUser(request, auth);
        const params = z
          .object({ projectId: z.string().uuid() })
          .safeParse(request.params);
        const query = restoreHistoryQuerySchema.safeParse(request.query);
        if (!params.success || !query.success) {
          return reply.status(404).send();
        }
        return {
          data: await sourceVersionRestores.list(
            params.data.projectId,
            user.id,
            query.data.limit,
          ),
          error: null,
        };
      } catch (error) {
        return restoreError(error, request, reply);
      }
    },
  );

  app.post(
    "/v1/projects/:projectId/source-versions/:versionId/restore",
    async (request, reply) => {
      try {
        const user = await requireUser(request, auth);
        const params = restoreParamsSchema.safeParse(request.params);
        const body = restoreSourceVersionSchema.safeParse(request.body);
        const idempotencyKey = request.headers["x-idempotency-key"];
        if (
          !params.success ||
          !body.success ||
          typeof idempotencyKey !== "string" ||
          idempotencyKey.length < 8 ||
          idempotencyKey.length > 128
        ) {
          return sendApiError(
            reply,
            request.id,
            400,
            "VALIDATION_FAILED",
            "طلب استعادة إصدار المصدر غير صالح أو يفتقد مفتاح idempotency.",
          );
        }
        const result = await sourceVersionRestores.restore({
          projectId: params.data.projectId,
          actorUserId: user.id,
          targetSourceVersionId: params.data.versionId,
          expectedCurrentSourceVersionId:
            body.data.expectedCurrentSourceVersionId,
          reason: body.data.reason,
          requestId: idempotencyKey,
        });
        return reply.status(result.replayed ? 200 : 201).send({
          data: result,
          error: null,
        });
      } catch (error) {
        return restoreError(error, request, reply);
      }
    },
  );
}

const restoreDomainError = createDomainErrorResponder(
  SourceVersionRestoreDomainError,
  (code) =>
    code === "PROJECT_NOT_FOUND" || code === "SOURCE_VERSION_NOT_FOUND"
      ? 404
      : 409,
);

function restoreError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  return restoreDomainError(error, request, reply);
}

function authError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const response = trySendAuthDomainError(error, request, reply);
  if (!response) throw error;
  return response;
}
