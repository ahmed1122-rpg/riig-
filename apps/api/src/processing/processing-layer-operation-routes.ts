import type { FastifyInstance } from "fastify";
import type { AuthService } from "../auth/auth-service.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import { sendApiError } from "../http/api-response.js";
import { createOwnedLayerMutationRunner } from "./layer-mutation-route.js";
import type { ProcessingService } from "./processing-service.js";
import {
  documentParamsSchema,
  mergeImageLayersSchema,
  mergeTextLayersSchema,
  navigateHistorySchema,
  refineImageEdgesSchema,
  splitTextLayerSchema,
} from "./processing-route-support.js";

export async function registerProcessingLayerOperationRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  processing: ProcessingService,
  auth: AuthService,
): Promise<void> {
  const runLayerMutation = createOwnedLayerMutationRunner(
    projects,
    auth,
    processing.settlesProjectReviewAtomically,
  );

  app.post(
    "/v1/projects/:projectId/layer-document/text/split",
    async (request, reply) => {
      const params = documentParamsSchema.safeParse(request.params);
      const body = splitTextLayerSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendApiError(
          reply,
          request.id,
          400,
          "VALIDATION_FAILED",
          "بيانات تقسيم الوحدة النصية غير صالحة.",
        );
      }
      return runLayerMutation(
        request,
        reply,
        params.data.projectId,
        body.data.sourceVersionId,
        ({ project, userId, operationId }) =>
          processing.splitPdfTextLayer({
            projectId: project.id,
            actorUserId: userId,
            operationId,
            ...body.data,
          }),
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/layer-document/text/merge",
    async (request, reply) => {
      const params = documentParamsSchema.safeParse(request.params);
      const body = mergeTextLayersSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendApiError(
          reply,
          request.id,
          400,
          "VALIDATION_FAILED",
          "بيانات دمج الوحدات النصية غير صالحة.",
        );
      }
      return runLayerMutation(
        request,
        reply,
        params.data.projectId,
        body.data.sourceVersionId,
        ({ project, userId, operationId }) =>
          processing.mergePdfTextLayers({
            projectId: project.id,
            actorUserId: userId,
            operationId,
            ...body.data,
          }),
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/layer-document/history",
    async (request, reply) => {
      const params = documentParamsSchema.safeParse(request.params);
      const body = navigateHistorySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendApiError(
          reply,
          request.id,
          400,
          "VALIDATION_FAILED",
          "بيانات التراجع أو الإعادة غير صالحة.",
        );
      }
      return runLayerMutation(
        request,
        reply,
        params.data.projectId,
        body.data.sourceVersionId,
        ({ project, userId, operationId }) =>
          processing.navigateEditHistory({
            projectId: project.id,
            actorUserId: userId,
            operationId,
            ...body.data,
          }),
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/layer-document/image/refine-edges",
    async (request, reply) => {
      const params = documentParamsSchema.safeParse(request.params);
      const body = refineImageEdgesSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendApiError(
          reply,
          request.id,
          400,
          "VALIDATION_FAILED",
          "بيانات تحسين حواف الصورة غير صالحة.",
        );
      }
      return runLayerMutation(
        request,
        reply,
        params.data.projectId,
        body.data.sourceVersionId,
        ({ project, userId, operationId }) =>
          processing.refineImageLayerEdges({
            projectId: project.id,
            actorUserId: userId,
            operationId,
            ...body.data,
          }),
      );
    },
  );

  app.post(
    "/v1/projects/:projectId/layer-document/image/merge",
    async (request, reply) => {
      const params = documentParamsSchema.safeParse(request.params);
      const body = mergeImageLayersSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendApiError(
          reply,
          request.id,
          400,
          "VALIDATION_FAILED",
          "بيانات دمج طبقات Raster غير صالحة.",
        );
      }
      return runLayerMutation(
        request,
        reply,
        params.data.projectId,
        body.data.sourceVersionId,
        ({ project, userId, operationId }) =>
          processing.mergeImageLayers({
            projectId: project.id,
            actorUserId: userId,
            operationId,
            ...body.data,
          }),
      );
    },
  );
}
