import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthService } from "../auth/auth-service.js";
import { requireUser } from "../auth/authorize.js";
import { trySendAuthDomainError } from "../auth/auth-route-error.js";
import { sendApiError, sendProjectNotFound } from "../http/api-response.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import { characterProjectParamsSchema } from "./character-rig-route-schemas.js";

export interface CharacterProjectAuthorizationDependencies {
  projects: ProjectRepository;
  auth: AuthService;
  enabled: boolean;
}

export async function authorizeCharacterProject(
  request: FastifyRequest,
  reply: FastifyReply,
  dependencies: CharacterProjectAuthorizationDependencies,
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
    const project = await dependencies.projects.findOwnedById(
      user.id,
      params.data.projectId,
    );
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
