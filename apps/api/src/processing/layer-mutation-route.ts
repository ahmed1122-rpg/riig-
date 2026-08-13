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
  mutate: (context: {
    project: ProjectSummary;
    userId: string;
    operationId: string;
  }) => Promise<TResult>;
}

export async function runOwnedLayerMutation<TResult>(
  options: OwnedLayerMutationOptions<TResult>,
) {
  const {
    request,
    reply,
    projects,
    auth,
    projectId,
    sourceVersionId,
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
    await projects.updateStatusForSource(
      project.id,
      sourceVersionId,
      "needs_review",
      null,
    );
    await projects.invalidateReview(project.id, sourceVersionId);
    return reply.status(200).send({ data: result, error: null });
  } catch (error) {
    return sendProcessingError(error, request, reply);
  }
}
