import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuditService } from "../audit/audit-service.js";
import { sendApiError } from "../http/api-response.js";
import { requestIdempotencyKey } from "../http/request-metadata.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import { readVerifiedCharacterArtifact } from "./character-artifact-integrity.js";
import {
  authorizeCharacterProject,
  type CharacterProjectAuthorizationDependencies,
} from "./character-rig-route-authorization.js";
import {
  sendCharacterDomainError,
  sendCharacterValidationError,
} from "./character-rig-route-errors.js";
import {
  characterRigArtifactParamsSchema,
  characterRigParamsSchema,
  characterRigReviewSchema,
} from "./character-rig-route-schemas.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";
import type { CharacterRigReviewService } from "./character-rig-review-service.js";

interface CharacterRigArtifactRouteDependencies
  extends CharacterProjectAuthorizationDependencies {
  characterRigs: CharacterRigRepository;
  rigReviewService: CharacterRigReviewService;
  objectStorage: ObjectStorage;
  audit: AuditService;
  now: () => Date;
}

export function registerCharacterRigArtifactRoutes(
  app: FastifyInstance,
  dependencies: CharacterRigArtifactRouteDependencies,
): void {
  app.get(
    "/v1/projects/:projectId/character-rig/rigs/:rigVersionId/artifacts/:artifactType",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const access = await authorizeCharacterProject(request, reply, dependencies);
      if (!access) return;
      const params = characterRigArtifactParamsSchema.safeParse(request.params);
      if (!params.success || params.data.projectId !== access.projectId) {
        return sendCharacterValidationError(request, reply);
      }
      const rig = await dependencies.characterRigs.findRigVersion(
        access.projectId,
        params.data.rigVersionId,
      );
      const artifact =
        params.data.artifactType === "psd"
          ? rig?.psdArtifact
          : rig?.manifestArtifact;
      if (!rig || !artifact) {
        return sendApiError(
          reply,
          request.id,
          404,
          "CHARACTER_RIG_ARTIFACT_NOT_FOUND",
          "The requested Character Rig artifact is not available.",
        );
      }
      const maxBytes =
        params.data.artifactType === "psd"
          ? 256 * 1024 * 1024
          : 8 * 1024 * 1024;
      const stored = await readVerifiedCharacterArtifact(
        dependencies.objectStorage,
        artifact,
        maxBytes,
      );
      if (!stored) return sendRigArtifactIntegrityError(request, reply);
      const extension = params.data.artifactType === "psd" ? "psd" : "json";
      return reply
        .type(artifact.contentType)
        .header("content-length", stored.sizeBytes)
        .header(
          "content-disposition",
          `attachment; filename="character-rig-v${rig.version}.${extension}"`,
        )
        .send(stored.body);
    },
  );

  app.post(
    "/v1/projects/:projectId/character-rig/rigs/:rigVersionId/reviews",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const access = await authorizeCharacterProject(request, reply, dependencies);
      if (!access) return;
      const params = characterRigParamsSchema.safeParse(request.params);
      const body = characterRigReviewSchema.safeParse(request.body);
      if (
        !params.success ||
        !body.success ||
        params.data.projectId !== access.projectId
      ) {
        return sendCharacterValidationError(request, reply);
      }
      try {
        const result = await dependencies.rigReviewService.review({
          projectId: access.projectId,
          rigVersionId: params.data.rigVersionId,
          ...body.data,
          operationId: requestIdempotencyKey(request),
          actorUserId: access.userId,
          reviewedAt: dependencies.now().toISOString(),
        });
        await dependencies.audit.record({
          actorUserId: access.userId,
          action: `character_rig.${body.data.decision}`,
          targetType: "character_rig",
          targetId: result.rig.id,
          outcome: "success",
          reason: body.data.reason,
          requestId: request.id,
        });
        return reply.status(result.replayed ? 200 : 201).send({
          data: result,
          error: null,
        });
      } catch (error) {
        return sendCharacterDomainError(error, request, reply);
      }
    },
  );
}

function sendRigArtifactIntegrityError(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  return sendApiError(
    reply,
    request.id,
    409,
    "CHARACTER_RIG_ARTIFACT_INTEGRITY_FAILED",
    "The Character Rig artifact failed integrity verification.",
  );
}
