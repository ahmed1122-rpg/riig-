import type { FastifyReply, FastifyRequest } from "fastify";
import type { ProjectSummary } from "@motionprep/contracts";
import { requireUser } from "../auth/authorize.js";
import type { AuthService } from "../auth/auth-service.js";
import { sendProjectNotFound } from "../http/api-response.js";
import { requestIdempotencyKey } from "../http/request-metadata.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import { ProcessingDomainError } from "./processing-service.js";
import { sendProcessingError } from "./processing-route-support.js";

interface OwnedLayerMutationOptions<TResult> {
  request: FastifyRequest;
  reply: FastifyReply;
  projects: ProjectRepository;
  auth: AuthService;
  projectId: string;
  sourceVersionId: string;
  projectReviewSettledAtomically: boolean;
  mutate: (context: {
    project: ProjectSummary;
    userId: string;
    operationId: string;
  }) => Promise<TResult>;
}

async function runOwnedLayerMutation<TResult>(
  options: OwnedLayerMutationOptions<TResult>,
) {
  const {
    request,
    reply,
    projects,
    auth,
    projectId,
    sourceVersionId,
    projectReviewSettledAtomically,
    mutate,
  } = options;
  try {
    const user = await requireUser(request, auth);
    const project = await projects.findOwnedById(user.id, projectId);
    if (!project) return sendProjectNotFound(reply, request.id);
    if (project.currentSourceVersionId !== sourceVersionId) {
      throw new ProcessingDomainError(
        "SOURCE_NOT_CURRENT",
        "لا يمكن تعديل طبقات إصدار مصدر لم يعد هو الإصدار الحالي.",
      );
    }
    const result = await mutate({
      project,
      userId: user.id,
      operationId: requestIdempotencyKey(request),
    });
    if (!projectReviewSettledAtomically) {
      const invalidated = await projects.invalidateReview(
        project.id,
        sourceVersionId,
      );
      if (!invalidated) {
        throw new ProcessingDomainError(
          "SOURCE_NOT_CURRENT",
          "The source changed before the project review could be invalidated.",
        );
      }
    }
    return reply.status(200).send({ data: result, error: null });
  } catch (error) {
    return sendProcessingError(error, request, reply);
  }
}

export function createOwnedLayerMutationRunner(
  projects: ProjectRepository,
  auth: AuthService,
  projectReviewSettledAtomically: boolean,
) {
  return async <TResult>(
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
    sourceVersionId: string,
    mutate: OwnedLayerMutationOptions<TResult>["mutate"],
  ) =>
    runOwnedLayerMutation({
      request,
      reply,
      projects,
      auth,
      projectId,
      sourceVersionId,
      projectReviewSettledAtomically,
      mutate,
    });
}
