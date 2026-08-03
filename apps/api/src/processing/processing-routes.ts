import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import type { ProcessingJob, ProjectSummary } from "@motionprep/contracts";
import { requireUser } from "../auth/authorize.js";
import type { AuthService } from "../auth/auth-service.js";
import {
  sendApiError,
  sendProjectNotFound,
} from "../http/api-response.js";
import { requestIdempotencyKey } from "../http/request-metadata.js";
import { requestTraceContext } from "../observability/tracing.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import {
  ProcessingDomainError,
  type ProcessingService,
} from "./processing-service.js";
import {
  createSchema,
  documentParamsSchema,
  guidedRefinementSchema,
  mergeImageLayersSchema,
  mergeTextLayersSchema,
  navigateHistorySchema,
  refineImageEdgesSchema,
  regionalOcrSchema,
  sendProcessingError as domainError,
  splitTextLayerSchema,
  updateDocumentSchema,
} from "./processing-route-support.js";
import { registerProcessingReadRoutes } from "./processing-read-routes.js";

export async function registerProcessingRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  processing: ProcessingService,
  auth: AuthService,
  options: { pdfRegionOcrEnabled?: boolean } = {},
): Promise<void> {
  const queueProcessingJob = async (
    request: FastifyRequest,
    userId: string,
    project: ProjectSummary,
    sourceVersionId: string,
    jobOptions: ProcessingJob["options"],
    operationId = requestIdempotencyKey(request),
  ) => {
    const job = await processing.createAndRun(
      project.id,
      sourceVersionId,
      project.kind,
      jobOptions,
      operationId,
      userId,
      async (queuedJob) =>
        Boolean(
          await projects.updateStatusForSource(
            project.id,
            queuedJob.sourceVersionId,
            "processing",
            { type: "processing", id: queuedJob.id },
          ),
        ),
      request.id,
      requestTraceContext(request),
    );
    if (job.status === "ready") {
      await projects.finishJobStatus(
        project.id,
        job.sourceVersionId,
        { type: "processing", id: job.id },
        "needs_review",
      );
    }
    return job;
  };
  const runLayerMutation = async <TResult>(
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
    sourceVersionId: string,
    mutate: (context: {
      project: ProjectSummary;
      userId: string;
      operationId: string;
    }) => Promise<TResult>,
  ) => {
    try {
      const user = await requireUser(request, auth);
      const project = await projects.findOwnedById(user.id, projectId);
      if (!project) return sendProjectNotFound(reply, request.id);
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
      return reply.status(200).send({ data: result, error: null });
    } catch (error) {
      return domainError(error, request, reply);
    }
  };

  await registerProcessingReadRoutes(app, projects, processing, auth);

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
    if (project.currentSourceVersionId !== body.data.sourceVersionId) {
      return sendApiError(
        reply,
        request.id,
        409,
        "SOURCE_NOT_CURRENT",
        "اختر إصدار المصدر الحالي أو استعد الإصدار المطلوب قبل المعالجة.",
      );
    }
    try {
      const job = await queueProcessingJob(
        request,
        user.id,
        project,
        body.data.sourceVersionId,
        project.kind === "book"
          ? { pdfSeparationMode: body.data.pdfSeparationMode ?? "sentence" }
          : {},
      );
      return reply.status(202).send({ data: job, error: null });
    } catch (error) {
      if (error instanceof ProcessingDomainError && error.jobId) {
        await projects.finishJobStatus(
          project.id,
          body.data.sourceVersionId,
          { type: "processing", id: error.jobId },
          "failed",
        );
      }
      return domainError(error, request, reply);
    }
  });

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
        await projects.updateStatusForSource(
          project.id,
          body.data.sourceVersionId,
          "needs_review",
          null,
        );
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
        if (project.currentSourceVersionId !== body.data.sourceVersionId) {
          return sendApiError(
            reply,
            request.id,
            409,
            "SOURCE_NOT_CURRENT",
            "استعد إصدار المصدر المطلوب قبل تشغيل OCR الإقليمي.",
          );
        }
        const operationId = requestIdempotencyKey(request);
        const job = await queueProcessingJob(
          request,
          user.id,
          project,
          body.data.sourceVersionId,
          {
            pdfRegionOcr: {
              ...body.data,
              actorUserId: user.id,
              operationId,
            },
          },
          operationId,
        );
        return reply.status(202).send({ data: job, error: null });
      } catch (error) {
        if (error instanceof ProcessingDomainError && error.jobId) {
          await projects.finishJobStatus(
            params.data.projectId,
            body.data.sourceVersionId,
            { type: "processing", id: error.jobId },
            "needs_review",
          );
        }
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
        ({ project }) =>
          processing.navigateEditHistory({
            projectId: project.id,
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
