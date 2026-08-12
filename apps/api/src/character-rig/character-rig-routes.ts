import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuditService } from "../audit/audit-service.js";
import { requireUser } from "../auth/authorize.js";
import { trySendAuthDomainError } from "../auth/auth-route-error.js";
import type { AuthService } from "../auth/auth-service.js";
import { sendApiError, sendProjectNotFound } from "../http/api-response.js";
import {
  InvalidIdempotencyKeyError,
  requestIdempotencyKey,
} from "../http/request-metadata.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import { CharacterBibleError, CharacterBibleService } from "./character-bible-service.js";
import {
  CharacterGenerationError,
  CharacterGenerationService,
} from "./character-generation-service.js";
import {
  CharacterIdentityBootstrapError,
  CharacterIdentityBootstrapService,
} from "./character-identity-bootstrap-service.js";
import { CharacterJobIdempotencyConflictError } from "./character-job-service.js";
import {
  CharacterRigCompilerError,
  CharacterRigCompilerService,
} from "./character-rig-compiler-service.js";
import {
  characterBibleApprovalSchema,
  characterBibleDraftSchema,
  characterGenerationParamsSchema,
  characterGenerationReviewSchema,
  characterGenerationSchema,
  characterIdentityBootstrapSchema,
  characterProjectParamsSchema,
  characterReferenceSchema,
  characterRigCompilationSchema,
} from "./character-rig-route-schemas.js";
import { CharacterReferenceError, CharacterReferenceService } from "./character-reference-service.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";

export async function registerCharacterRigRoutes(
  app: FastifyInstance,
  dependencies: {
    projects: ProjectRepository;
    auth: AuthService;
    characterRigs: CharacterRigRepository;
    bibleService: CharacterBibleService;
    referenceService: CharacterReferenceService;
    identityService: CharacterIdentityBootstrapService;
    generationService: CharacterGenerationService;
    compilerService: CharacterRigCompilerService;
    objectStorage: ObjectStorage;
    audit: AuditService;
    enabled: boolean;
    providerKey: string;
    baseModelReference: string;
    now?: () => Date;
  },
): Promise<void> {
  const now = dependencies.now ?? (() => new Date());

  app.get(
    "/v1/projects/:projectId/character-rig",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const access = await authorizeCharacterProject(request, reply, dependencies);
    if (!access) return;
    const bible = await dependencies.characterRigs.findLatestBible(access.projectId);
    const references = bible
      ? await dependencies.characterRigs.listReferences(access.projectId, bible.id)
      : [];
    const [identityModel, generations, rig] = bible
      ? await Promise.all([
          dependencies.characterRigs.findLatestIdentityModelVersion(
            access.projectId,
            bible.id,
          ),
          dependencies.characterRigs.listGenerationAttempts(
            access.projectId,
            bible.id,
          ),
          dependencies.characterRigs.findLatestRigVersion(
            access.projectId,
            bible.id,
          ),
        ])
      : [null, [], null];
    return {
      data: { bible, references, identityModel, generations, rig },
      error: null,
    };
    },
  );

  app.put(
    "/v1/projects/:projectId/character-rig/bible",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
    const access = await authorizeCharacterProject(request, reply, dependencies);
    if (!access) return;
    const body = characterBibleDraftSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const bible = await dependencies.bibleService.saveDraft({
        projectId: access.projectId,
        ...body.data,
        palette: body.data.palette.map((entry) => ({
          ...entry,
          color: entry.color as `#${string}`,
        })),
        actorUserId: access.userId,
        updatedAt: now().toISOString(),
      });
      return { data: bible, error: null };
    } catch (error) {
      return characterError(error, request, reply);
    }
    },
  );

  app.post(
    "/v1/projects/:projectId/character-rig/bible/approve",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const access = await authorizeCharacterProject(request, reply, dependencies);
      if (!access) return;
      const body = characterBibleApprovalSchema.safeParse(request.body);
      if (!body.success) return validationError(request, reply);
      try {
        const bible = await dependencies.bibleService.approve({
          projectId: access.projectId,
          ...body.data,
          actorUserId: access.userId,
          approvedAt: now().toISOString(),
        });
        await dependencies.audit.record({
          actorUserId: access.userId,
          action: "character_bible.approve",
          targetType: "character_bible",
          targetId: bible.id,
          outcome: "success",
          reason: null,
          requestId: request.id,
        });
        return { data: bible, error: null };
      } catch (error) {
        return characterError(error, request, reply);
      }
    },
  );

  app.post(
    "/v1/projects/:projectId/character-rig/references/current-source",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const access = await authorizeCharacterProject(request, reply, dependencies);
      if (!access) return;
      const body = characterReferenceSchema.safeParse(request.body);
      if (!body.success) return validationError(request, reply);
      try {
        const reference = await dependencies.referenceService.addCurrentSource({
          projectId: access.projectId,
          ...body.data,
          actorUserId: access.userId,
        });
        return reply.status(201).send({ data: reference, error: null });
      } catch (error) {
        return characterError(error, request, reply);
      }
    },
  );

  app.post(
    "/v1/projects/:projectId/character-rig/identity-model",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const access = await authorizeCharacterProject(request, reply, dependencies);
      if (!access) return;
      const body = characterIdentityBootstrapSchema.safeParse(request.body);
      if (!body.success) return validationError(request, reply);
      try {
        const result = await dependencies.identityService.bootstrap({
          projectId: access.projectId,
          bibleId: body.data.bibleId,
          providerKey: dependencies.providerKey,
          baseModelReference: dependencies.baseModelReference,
          trainingConfiguration: {
            preserveIdentity: true,
            canonicalViewCount: 5,
          },
          requestedAt: now().toISOString(),
        });
        return reply.status(result.job.attempt === 0 ? 202 : 200).send({
          data: result,
          error: null,
        });
      } catch (error) {
        return characterError(error, request, reply);
      }
    },
  );

  app.post(
    "/v1/projects/:projectId/character-rig/generations",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const access = await authorizeCharacterProject(request, reply, dependencies);
      if (!access) return;
      const body = characterGenerationSchema.safeParse(request.body);
      if (!body.success) return validationError(request, reply);
      try {
        const result = await dependencies.generationService.queue({
          projectId: access.projectId,
          ...body.data,
          idempotencyKey: requestIdempotencyKey(request),
          actorUserId: access.userId,
          requestedAt: now().toISOString(),
        });
        return reply.status(result.replayed ? 200 : 202).send({
          data: result,
          error: null,
        });
      } catch (error) {
        return characterError(error, request, reply);
      }
    },
  );

  app.post(
    "/v1/projects/:projectId/character-rig/generations/:generationAttemptId/reviews",
    { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const access = await authorizeCharacterProject(request, reply, dependencies);
      if (!access) return;
      const params = characterGenerationParamsSchema.safeParse(request.params);
      const body = characterGenerationReviewSchema.safeParse(request.body);
      if (!params.success || !body.success || params.data.projectId !== access.projectId) {
        return validationError(request, reply);
      }
      try {
        const result = await dependencies.generationService.review({
          projectId: access.projectId,
          generationAttemptId: params.data.generationAttemptId,
          ...body.data,
          operationId: requestIdempotencyKey(request),
          actorUserId: access.userId,
          reviewedAt: now().toISOString(),
        });
        await dependencies.audit.record({
          actorUserId: access.userId,
          action: `character_generation.${body.data.decision}`,
          targetType: "character_generation",
          targetId: result.attempt.id,
          outcome: "success",
          reason: body.data.reason,
          requestId: request.id,
        });
        return reply.status(result.replayed ? 200 : 201).send({
          data: result,
          error: null,
        });
      } catch (error) {
        return characterError(error, request, reply);
      }
    },
  );

  app.get(
    "/v1/projects/:projectId/character-rig/generations/:generationAttemptId/artifact",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const access = await authorizeCharacterProject(request, reply, dependencies);
      if (!access) return;
      const params = characterGenerationParamsSchema.safeParse(request.params);
      if (!params.success || params.data.projectId !== access.projectId) {
        return validationError(request, reply);
      }
      const attempt = await dependencies.characterRigs.findGenerationAttempt(
        access.projectId,
        params.data.generationAttemptId,
      );
      if (!attempt?.outputArtifact) {
        return sendApiError(
          reply,
          request.id,
          404,
          "CHARACTER_ARTIFACT_NOT_FOUND",
          "The generated character artifact is not available.",
        );
      }
      const artifact = await dependencies.objectStorage.get(
        attempt.outputArtifact.objectKey,
        { maxBytes: 64 * 1024 * 1024 },
      );
      if (
        !artifact ||
        artifact.contentType !== attempt.outputArtifact.contentType ||
        artifact.sizeBytes !== attempt.outputArtifact.sizeBytes
      ) {
        return sendApiError(
          reply,
          request.id,
          409,
          "CHARACTER_ARTIFACT_INTEGRITY_FAILED",
          "The generated character artifact failed integrity verification.",
        );
      }
      return reply
        .type(attempt.outputArtifact.contentType)
        .header("content-length", artifact.sizeBytes)
        .send(artifact.body);
    },
  );

  app.post(
    "/v1/projects/:projectId/character-rig/compile",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const access = await authorizeCharacterProject(request, reply, dependencies);
      if (!access) return;
      const body = characterRigCompilationSchema.safeParse(request.body);
      if (!body.success) return validationError(request, reply);
      try {
        const result = await dependencies.compilerService.queue({
          projectId: access.projectId,
          ...body.data,
          idempotencyKey: requestIdempotencyKey(request),
          requestedAt: now().toISOString(),
        });
        return reply.status(result.replayed ? 200 : 202).send({
          data: result,
          error: null,
        });
      } catch (error) {
        return characterError(error, request, reply);
      }
    },
  );
}

async function authorizeCharacterProject(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: {
    projects: ProjectRepository;
    auth: AuthService;
    enabled: boolean;
  },
): Promise<{ projectId: string; userId: string } | null> {
  try {
    const user = await requireUser(request, dependencies.auth);
    if (!dependencies.enabled) {
      sendApiError(
        reply,
        request.id,
        503,
        "CHARACTER_RIG_DISABLED",
        "Character Studio is disabled until its private worker and release gates are configured.",
      );
      return null;
    }
    const params = characterProjectParamsSchema.safeParse(request.params);
    if (!params.success) {
      sendProjectNotFound(reply, request.id);
      return null;
    }
    const project = await dependencies.projects.findOwnedById(user.id, params.data.projectId);
    if (!project || project.kind !== "image") {
      sendProjectNotFound(reply, request.id);
      return null;
    }
    return { projectId: project.id, userId: user.id };
  } catch (error) {
    const response = trySendAuthDomainError(error, request, reply);
    if (response !== undefined) return null;
    throw error;
  }
}

function validationError(request: FastifyRequest, reply: FastifyReply) {
  return sendApiError(
    reply,
    request.id,
    400,
    "VALIDATION_FAILED",
    "Character Studio request data is invalid.",
  );
}

function characterError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (
    error instanceof CharacterBibleError ||
    error instanceof CharacterReferenceError ||
    error instanceof CharacterIdentityBootstrapError ||
    error instanceof CharacterGenerationError ||
    error instanceof CharacterRigCompilerError ||
    error instanceof CharacterJobIdempotencyConflictError ||
    error instanceof InvalidIdempotencyKeyError
  ) {
    const code = "code" in error && typeof error.code === "string"
      ? error.code
      : "CHARACTER_REQUEST_INVALID";
    const conflict = code.includes("CONFLICT") || code.includes("REVISION");
    const notFound = code.endsWith("NOT_FOUND");
    return sendApiError(
      reply,
      request.id,
      notFound ? 404 : conflict ? 409 : 422,
      code,
      "Character Studio could not complete the requested operation.",
    );
  }
  throw error;
}
