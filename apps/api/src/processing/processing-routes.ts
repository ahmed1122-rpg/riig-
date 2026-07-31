import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/authorize.js";
import type { AuthService } from "../auth/auth-service.js";
import {
  sendApiError,
  sendProjectNotFound,
} from "../http/api-response.js";
import { createDomainErrorResponder } from "../http/domain-route-error.js";
import { requestIdempotencyKey } from "../http/request-metadata.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import {
  ProcessingDomainError,
  type ProcessingService,
} from "./processing-service.js";
import { UsageLimitError } from "../billing/usage-meter.js";

const createSchema = z.object({
  projectId: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  pdfSeparationMode: z
    .enum(["heading", "topic", "sentence", "line", "word", "character"])
    .optional(),
});
const jobParamsSchema = z.object({ jobId: z.string().uuid() });
const documentParamsSchema = z.object({ projectId: z.string().uuid() });
const layerAssetParamsSchema = z.object({
  projectId: z.string().uuid(),
  layerId: z.string().min(1).max(128),
});
const documentQuerySchema = z.object({
  sourceVersionId: z.string().uuid().optional(),
});
const layerAssetQuerySchema = z.object({
  sourceVersionId: z.string().uuid(),
});
const layerStateUpdateSchema = z.object({
  id: z.string().min(1).max(128),
  name: z
    .string()
    .min(2)
    .max(121)
    .refine(
      (name) =>
        name.startsWith("+") &&
        !name.startsWith("++") &&
        !/[\u0000-\u001F\u007F\\/]/u.test(name),
    )
    .transform((name) => name as `+${string}`),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: z.number().finite().min(0).max(1),
  zIndex: z.number().int().nonnegative().max(1_000_000),
  readingOrder: z.number().int().nonnegative().max(1_000_000).optional(),
});
const updateDocumentSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  layers: z.array(layerStateUpdateSchema).min(1).max(1_000),
});
const normalizedPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
const imageStrokeSchema = z.object({
  id: z.string().min(1).max(128),
  targetLayerId: z.string().min(1).max(128).nullable(),
  kind: z.enum(["include", "exclude", "separate"]),
  brushSize: z.number().finite().min(2).max(80),
  points: z.array(normalizedPointSchema).min(2).max(1_000),
  createdAt: z.string().datetime(),
});
const pdfRegionSchema = z.object({
  id: z.string().min(1).max(128),
  pageNumber: z.number().int().positive().max(250),
  kind: z.enum(["heading", "line", "topic", "ignore"]),
  start: normalizedPointSchema,
  end: normalizedPointSchema,
  readingOrder: z.number().int().nonnegative().nullable(),
  createdAt: z.string().datetime(),
});
const guidedRefinementSchema = z
  .object({
    sourceVersionId: z.string().uuid(),
    baseRevision: z.number().int().positive(),
    mode: z.enum(["automatic", "manual", "guided"]),
    imageStrokes: z.array(imageStrokeSchema).max(100),
    pdfRegions: z.array(pdfRegionSchema).max(100),
  })
  .superRefine((value, context) => {
    const pointCount = value.imageStrokes.reduce(
      (sum, stroke) => sum + stroke.points.length,
      0,
    );
    if (pointCount > 10_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageStrokes"],
        message: "A refinement may contain at most 10,000 stroke points.",
      });
    }
  });
const splitTextLayerSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  layerId: z.string().min(1).max(128),
  offset: z.number().int().positive().max(1_000_000),
});
const mergeTextLayersSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  layerIds: z.array(z.string().min(1).max(128)).min(2).max(50),
  separator: z.enum(["space", "newline"]),
});
const regionalOcrSchema = z
  .object({
    sourceVersionId: z.string().uuid(),
    baseRevision: z.number().int().positive(),
    pageNumber: z.number().int().positive().max(250),
    start: normalizedPointSchema,
    end: normalizedPointSchema,
  })
  .superRefine((value, context) => {
    if (
      Math.abs(value.end.x - value.start.x) < 0.005 ||
      Math.abs(value.end.y - value.start.y) < 0.005
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "The regional OCR selection is too small.",
      });
    }
  });
const navigateHistorySchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  direction: z.enum(["undo", "redo"]),
});
const refineImageEdgesSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  layerId: z.string().min(1).max(128),
  radius: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  strength: z.number().finite().min(0.1).max(1),
});
const mergeImageLayersSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  layerIds: z.array(z.string().min(1).max(128)).min(2).max(15),
});

export async function registerProcessingRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  processing: ProcessingService,
  auth: AuthService,
  options: { pdfRegionOcrEnabled?: boolean } = {},
): Promise<void> {
  const findRequestProject = async (
    request: FastifyRequest,
    projectId: string,
  ) => {
    const user = await requireUser(request, auth);
    return projects.findOwnedById(user.id, projectId);
  };

  app.post("/v1/processing/jobs", async (request, reply) => {
    let user;
    try {
      user = await requireUser(request, auth);
    } catch (error) {
      return domainError(error, request, reply);
    }
    const body = createSchema.safeParse(request.body);
    if (!body.success) {
      return sendApiError(
        reply,
        request.id,
        400,
        "VALIDATION_FAILED",
        "بيانات مهمة المعالجة غير صالحة.",
      );
    }
    const project = await projects.findOwnedById(user.id, body.data.projectId);
    if (!project) {
      return sendProjectNotFound(reply, request.id);
    }
    await projects.updateStatus(project.id, "processing");
    try {
      const job = await processing.createAndRun(
        project.id,
        body.data.sourceVersionId,
        project.kind,
        project.kind === "book"
          ? { pdfSeparationMode: body.data.pdfSeparationMode ?? "sentence" }
          : {},
        requestIdempotencyKey(request),
        user.id,
      );
      if (job.status === "ready") {
        await projects.updateStatus(project.id, "needs_review");
      }
      return reply.status(202).send({ data: job, error: null });
    } catch (error) {
      await projects.updateStatus(project.id, "failed");
      return domainError(error, request, reply);
    }
  });

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
      return { data: job, error: null };
    } catch (error) {
      return domainError(error, request, reply);
    }
  });

  app.get(
    "/v1/projects/:projectId/layer-document",
    async (request, reply) => {
      const params = documentParamsSchema.safeParse(request.params);
      const query = documentQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) return reply.status(404).send();
      try {
        const project = await findRequestProject(
          request,
          params.data.projectId,
        );
        if (!project) {
          return sendProjectNotFound(reply, request.id);
        }
        return {
          data: await processing.findDocument(
            project.id,
            query.data.sourceVersionId,
          ),
          error: null,
        };
      } catch (error) {
        return domainError(error, request, reply);
      }
    },
  );

  app.get(
    "/v1/projects/:projectId/layers/:layerId/asset",
    async (request, reply) => {
      const params = layerAssetParamsSchema.safeParse(request.params);
      const query = layerAssetQuerySchema.safeParse(request.query);
      if (!params.success || !query.success) {
        return reply.status(404).send();
      }
      try {
        const user = await requireUser(request, auth);
        const project = await projects.findOwnedById(
          user.id,
          params.data.projectId,
        );
        if (!project) {
          return sendProjectNotFound(reply, request.id);
        }
        const asset = await processing.findRasterAsset(
          project.id,
          query.data.sourceVersionId,
          params.data.layerId,
        );
        return reply
          .header("cache-control", "private, max-age=86400, immutable")
          .type(asset.contentType)
          .send(asset.body);
      } catch (error) {
        return domainError(error, request, reply);
      }
    },
  );

  app.patch(
    "/v1/projects/:projectId/layer-document",
    async (request, reply) => {
      const params = documentParamsSchema.safeParse(request.params);
      const body = updateDocumentSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendApiError(
          reply,
          request.id,
          400,
          "VALIDATION_FAILED",
          "تحديثات وثيقة الطبقات غير صالحة.",
        );
      }
      try {
        const user = await requireUser(request, auth);
        const project = await projects.findOwnedById(
          user.id,
          params.data.projectId,
        );
        if (!project) {
          return sendProjectNotFound(reply, request.id);
        }
        const updated = await processing.updateLayerStates(
          project.id,
          body.data.sourceVersionId,
          project.kind,
          body.data.baseRevision,
          body.data.layers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
            locked: layer.locked,
            opacity: layer.opacity,
            zIndex: layer.zIndex,
            ...(layer.readingOrder === undefined
              ? {}
              : { readingOrder: layer.readingOrder }),
          })),
          user.id,
          requestIdempotencyKey(request),
        );
        return { data: updated, error: null };
      } catch (error) {
        return domainError(error, request, reply);
      }
    },
  );

  app.post(
    "/v1/projects/:projectId/guided-refinements",
    async (request, reply) => {
      const params = documentParamsSchema.safeParse(request.params);
      const body = guidedRefinementSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendApiError(
          reply,
          request.id,
          400,
          "VALIDATION_FAILED",
          "بيانات التحديد اليدوي غير صالحة.",
        );
      }
      try {
        const user = await requireUser(request, auth);
        const project = await projects.findOwnedById(
          user.id,
          params.data.projectId,
        );
        if (!project) {
          return sendProjectNotFound(reply, request.id);
        }
        const result = await processing.applyGuidedRefinement({
          projectId: project.id,
          projectKind: project.kind,
          ...body.data,
          actorUserId: user.id,
          operationId: requestIdempotencyKey(request),
        });
        await projects.updateStatus(project.id, "needs_review");
        return reply.status(200).send({ data: result, error: null });
      } catch (error) {
        return domainError(error, request, reply);
      }
    },
  );

  app.post(
    "/v1/projects/:projectId/layer-document/text/region-ocr",
    async (request, reply) => {
      const params = documentParamsSchema.safeParse(request.params);
      const body = regionalOcrSchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return sendApiError(
          reply,
          request.id,
          400,
          "VALIDATION_FAILED",
          "بيانات منطقة OCR غير صالحة.",
        );
      }
      try {
        const user = await requireUser(request, auth);
        const project = await projects.findOwnedById(
          user.id,
          params.data.projectId,
        );
        if (!project) return sendProjectNotFound(reply, request.id);
        if (options.pdfRegionOcrEnabled === false) {
          return sendApiError(
            reply,
            request.id,
            503,
            "FEATURE_DISABLED",
            "أوقِفت أداة OCR الإقليمي مؤقتًا بواسطة إعداد التشغيل.",
          );
        }
        if (project.kind !== "book") {
          throw new ProcessingDomainError(
            "INVALID_DOCUMENT_OPERATION",
            "OCR الإقليمي متاح لمستندات PDF فقط.",
          );
        }
        const operationId = requestIdempotencyKey(request);
        const job = await processing.createAndRun(
          project.id,
          body.data.sourceVersionId,
          project.kind,
          {
            pdfRegionOcr: {
              ...body.data,
              actorUserId: user.id,
              operationId,
            },
          },
          operationId,
          user.id,
        );
        return reply.status(202).send({ data: job, error: null });
      } catch (error) {
        return domainError(error, request, reply);
      }
    },
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
      try {
        const user = await requireUser(request, auth);
        const project = await projects.findOwnedById(
          user.id,
          params.data.projectId,
        );
        if (!project) return sendProjectNotFound(reply, request.id);
        const result = await processing.splitPdfTextLayer({
          projectId: project.id,
          actorUserId: user.id,
          operationId: requestIdempotencyKey(request),
          ...body.data,
        });
        await projects.updateStatus(project.id, "needs_review");
        return reply.status(200).send({ data: result, error: null });
      } catch (error) {
        return domainError(error, request, reply);
      }
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
      try {
        const user = await requireUser(request, auth);
        const project = await projects.findOwnedById(
          user.id,
          params.data.projectId,
        );
        if (!project) return sendProjectNotFound(reply, request.id);
        const result = await processing.mergePdfTextLayers({
          projectId: project.id,
          actorUserId: user.id,
          operationId: requestIdempotencyKey(request),
          ...body.data,
        });
        await projects.updateStatus(project.id, "needs_review");
        return reply.status(200).send({ data: result, error: null });
      } catch (error) {
        return domainError(error, request, reply);
      }
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
      try {
        const project = await findRequestProject(
          request,
          params.data.projectId,
        );
        if (!project) return sendProjectNotFound(reply, request.id);
        const document = await processing.navigateEditHistory({
          projectId: project.id,
          ...body.data,
        });
        await projects.updateStatus(project.id, "needs_review");
        return reply.status(200).send({ data: document, error: null });
      } catch (error) {
        return domainError(error, request, reply);
      }
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
      try {
        const user = await requireUser(request, auth);
        const project = await projects.findOwnedById(
          user.id,
          params.data.projectId,
        );
        if (!project) return sendProjectNotFound(reply, request.id);
        const result = await processing.refineImageLayerEdges({
          projectId: project.id,
          actorUserId: user.id,
          operationId: requestIdempotencyKey(request),
          ...body.data,
        });
        await projects.updateStatus(project.id, "needs_review");
        return reply.status(200).send({ data: result, error: null });
      } catch (error) {
        return domainError(error, request, reply);
      }
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
      try {
        const user = await requireUser(request, auth);
        const project = await projects.findOwnedById(
          user.id,
          params.data.projectId,
        );
        if (!project) return sendProjectNotFound(reply, request.id);
        const result = await processing.mergeImageLayers({
          projectId: project.id,
          actorUserId: user.id,
          operationId: requestIdempotencyKey(request),
          ...body.data,
        });
        await projects.updateStatus(project.id, "needs_review");
        return reply.status(200).send({ data: result, error: null });
      } catch (error) {
        return domainError(error, request, reply);
      }
    },
  );
}

const processingDomainError = createDomainErrorResponder(
  ProcessingDomainError,
  (code) =>
    code === "PROCESSING_NOT_FOUND" ||
    code === "DOCUMENT_NOT_FOUND" ||
    code === "LAYER_ASSET_NOT_FOUND"
      ? 404
      : code === "DOCUMENT_REVISION_CONFLICT" ||
          code === "PROCESSING_IN_PROGRESS" ||
          code === "GUIDANCE_DUPLICATE" ||
          code === "EDIT_HISTORY_UNAVAILABLE"
        ? 409
        : code === "LAYER_ASSET_INTEGRITY_FAILED" ||
            code === "SOURCE_INTEGRITY_FAILED"
          ? 500
          : code === "IMAGE_LAYER_LIMIT_EXCEEDED" ||
              code === "OCR_REQUIRED" ||
              code === "OCR_FAILED" ||
              code === "INVALID_DOCUMENT_OPERATION"
            ? 422
            : code === "PDF_TOO_MANY_PAGES" ||
                code === "PDF_TEXT_LIMIT_EXCEEDED"
              ? 413
              : 400,
);

function domainError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof UsageLimitError) {
    return sendApiError(
      reply,
      request.id,
      error.code === "SUBSCRIPTION_INACTIVE" ? 403 : 429,
      error.code,
      error.message,
    );
  }
  return processingDomainError(error, request, reply);
}
