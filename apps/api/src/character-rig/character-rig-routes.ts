import type { FastifyInstance } from "fastify";
import type { AuditService } from "../audit/audit-service.js";
import type { AuthService } from "../auth/auth-service.js";
import { sendApiError } from "../http/api-response.js";
import { requestIdempotencyKey } from "../http/request-metadata.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import { CharacterBibleService } from "./character-bible-service.js";
import type { CharacterJobRepository } from "./character-job-repository.js";
import { CharacterReferenceService } from "./character-reference-service.js";
import { CharacterRigCompilerService } from "./character-rig-compiler-service.js";
import {
  characterBibleApprovalSchema,
  characterBibleDraftSchema,
  characterReferenceSchema,
  characterRigCompilationSchema,
} from "./character-rig-route-schemas.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";
import type { CharacterRigReviewService } from "./character-rig-review-service.js";
import { registerCharacterRigArtifactRoutes } from "./character-rig-artifact-routes.js";
import { authorizeCharacterProject } from "./character-rig-route-authorization.js";
import {
  sendCharacterDomainError,
  sendCharacterValidationError,
} from "./character-rig-route-errors.js";

interface CharacterRigRouteDependencies {
  projects: ProjectRepository;
  auth: AuthService;
  characterRigs: CharacterRigRepository;
  characterJobs: CharacterJobRepository;
  bibleService: CharacterBibleService;
  referenceService: CharacterReferenceService;
  compilerService: CharacterRigCompilerService;
  rigReviewService: CharacterRigReviewService;
  objectStorage: ObjectStorage;
  audit: AuditService;
  enabled: boolean;
  now?: () => Date;
}

export async function registerCharacterRigRoutes(
  app: FastifyInstance,
  dependencies: CharacterRigRouteDependencies,
): Promise<void> {
  const now = dependencies.now ?? (() => new Date());
  registerCharacterRigArtifactRoutes(app, { ...dependencies, now });

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
      const [rig, jobs] = bible
        ? await Promise.all([
            dependencies.characterRigs.findLatestRigVersion(
              access.projectId,
              bible.id,
            ),
            dependencies.characterJobs.listByProject(access.projectId),
          ])
        : [null, []];
      return {
        data: { bible, references, rig, jobs },
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
      if (!body.success) return sendCharacterValidationError(request, reply);
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
        return sendCharacterDomainError(error, request, reply);
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
      if (!body.success) return sendCharacterValidationError(request, reply);
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
        return sendCharacterDomainError(error, request, reply);
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
      if (!body.success) return sendCharacterValidationError(request, reply);
      try {
        const reference = await dependencies.referenceService.addCurrentSource({
          projectId: access.projectId,
          ...body.data,
          actorUserId: access.userId,
        });
        return reply.status(201).send({ data: reference, error: null });
      } catch (error) {
        return sendCharacterDomainError(error, request, reply);
      }
    },
  );

  registerRetiredGenerationRoutes(app, dependencies);

  app.post(
    "/v1/projects/:projectId/character-rig/compile",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const access = await authorizeCharacterProject(request, reply, dependencies);
      if (!access) return;
      const body = characterRigCompilationSchema.safeParse(request.body);
      if (!body.success) return sendCharacterValidationError(request, reply);
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
        return sendCharacterDomainError(error, request, reply);
      }
    },
  );
}

function registerRetiredGenerationRoutes(
  app: FastifyInstance,
  dependencies: CharacterRigRouteDependencies,
): void {
  const retiredRoutes = [
    { method: "POST" as const, url: "/v1/projects/:projectId/character-rig/identity-model" },
    { method: "POST" as const, url: "/v1/projects/:projectId/character-rig/generations" },
    { method: "POST" as const, url: "/v1/projects/:projectId/character-rig/generations/:generationAttemptId/reviews" },
    { method: "GET" as const, url: "/v1/projects/:projectId/character-rig/generations/:generationAttemptId/artifact" },
  ];
  for (const route of retiredRoutes) {
    app.route({
      method: route.method,
      url: route.url,
      schema: { hide: true },
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      handler: async (request, reply) => {
        const access = await authorizeCharacterProject(request, reply, dependencies);
        if (!access) return;
        return sendApiError(
          reply,
          request.id,
          409,
          "CHARACTER_GENERATION_DISABLED_SOURCE_ONLY",
          "Character Studio preserves uploaded source pixels and does not train or generate images.",
        );
      },
    });
  }
}
