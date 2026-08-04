import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/authorize.js";
import type { AuthService } from "../auth/auth-service.js";
import {
  sendApiError,
  sendProjectNotFound,
} from "../http/api-response.js";
import { toProcessingJobDto } from "../jobs/job-dtos.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import {
  ProcessingDomainError,
  type ProcessingService,
} from "./processing-service.js";
import {
  documentParamsSchema,
  documentQuerySchema,
  jobParamsSchema,
  layerAssetParamsSchema,
  layerAssetQuerySchema,
  sendProcessingError,
} from "./processing-route-support.js";

export async function registerProcessingReadRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  processing: ProcessingService,
  auth: AuthService,
): Promise<void> {
  app.get("/v1/processing/jobs/:jobId", async (request, reply) => {
    const params = jobParamsSchema.safeParse(request.params);
    if (!params.success) return reply.status(404).send();
    try {
      const user = await requireUser(request, auth);
      const job = await processing.findJob(params.data.jobId);
      const project = await projects.findOwnedById(user.id, job.projectId);
      if (!project) {
        throw new ProcessingDomainError(
          "PROCESSING_NOT_FOUND",
          "مهمة المعالجة غير موجودة.",
        );
      }
      return { data: toProcessingJobDto(job), error: null };
    } catch (error) {
      return sendProcessingError(error, request, reply);
    }
  });

  app.get(
    "/v1/projects/:projectId/layer-document",
    async (request, reply) => {
      const params = documentParamsSchema.safeParse(request.params);
      const query = documentQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) return reply.status(404).send();
      try {
        const user = await requireUser(request, auth);
        const project = await projects.findOwnedById(
          user.id,
          params.data.projectId,
        );
        if (!project) return sendProjectNotFound(reply, request.id);
        return {
          data: await processing.findDocument(
            project.id,
            query.data.sourceVersionId,
          ),
          error: null,
        };
      } catch (error) {
        return sendProcessingError(error, request, reply);
      }
    },
  );

  app.get(
    "/v1/projects/:projectId/layers/:layerId/asset",
    async (request, reply) => {
      const params = layerAssetParamsSchema.safeParse(request.params);
      const query = layerAssetQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) return reply.status(404).send();
      try {
        const user = await requireUser(request, auth);
        const project = await projects.findOwnedById(
          user.id,
          params.data.projectId,
        );
        if (!project) return sendProjectNotFound(reply, request.id);
        const asset = await processing.findRasterAsset(
          project.id,
          query.data.sourceVersionId,
          params.data.layerId,
        );
        if (
          query.data.assetSha256 &&
          query.data.assetSha256 !== asset.sha256
        ) {
          return sendApiError(
            reply,
            request.id,
            409,
            "LAYER_ASSET_VERSION_MISMATCH",
            "تغير أصل الطبقة منذ تحميل الوثيقة. حدّث مساحة العمل للحصول على النسخة الأحدث.",
          );
        }
        const etag = `"${asset.sha256}"`;
        const cacheControl = query.data.assetSha256
          ? "private, max-age=31536000, immutable"
          : "private, no-cache";
        if (request.headers["if-none-match"] === etag) {
          return reply
            .status(304)
            .header("cache-control", cacheControl)
            .header("etag", etag)
            .send();
        }
        return reply
          .header("cache-control", cacheControl)
          .header("etag", etag)
          .type(asset.contentType)
          .send(asset.body);
      } catch (error) {
        return sendProcessingError(error, request, reply);
      }
    },
  );
}
