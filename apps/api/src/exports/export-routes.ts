import { exportFormats } from "@motionprep/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/authorize.js";
import type { AuthService } from "../auth/auth-service.js";
import {
  sendApiError,
  sendProjectNotFound,
} from "../http/api-response.js";
import { createDomainErrorResponder } from "../http/domain-route-error.js";
import { requestIdempotencyKey } from "../http/request-metadata.js";
import { runResourceRoute } from "../http/resource-route.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import {
  ExportDomainError,
  ExportExecutionError,
  type ExportService,
} from "./export-service.js";

const exportSchema = z
  .object({
    projectId: z.string().uuid(),
    sourceVersionId: z.string().uuid(),
    documentRevision: z.number().int().positive().optional(),
    format: z.enum(exportFormats),
    scope: z.enum(["full-document", "per-page", "selected-page"]),
    selectedPage: z.number().int().positive().max(250).optional(),
    scale: z.union([z.literal(1), z.literal(2)]),
    colorProfile: z.enum(["sRGB", "display-p3"]),
    namingPresetId: z.string().trim().min(1).max(80),
  })
  .superRefine((value, context) => {
    if (value.scope === "selected-page" && value.selectedPage === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedPage"],
        message: "selectedPage is required for selected-page exports.",
      });
    }
    if (value.scope !== "selected-page" && value.selectedPage !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["selectedPage"],
        message: "selectedPage is only valid for selected-page exports.",
      });
    }
  });

const paramsSchema = z.object({ exportId: z.string().uuid() });

const domainError = createDomainErrorResponder(
  ExportDomainError,
  (code) =>
    code === "EXPORT_NOT_FOUND"
      ? 404
      : code === "EXPORT_REQUEST_IN_PROGRESS" ||
          code === "EXPORT_DOCUMENT_REVISION_CONFLICT" ||
          code === "EXPORT_SOURCE_NOT_CURRENT"
        ? 409
        : code === "EXPORT_SOURCE_INTEGRITY_FAILED" ||
            code === "EXPORT_ARTIFACT_INTEGRITY_FAILED"
          ? 500
          : 400,
);

function exportIdFrom(params: unknown): string | undefined {
  const parsed = paramsSchema.safeParse(params);
  return parsed.success ? parsed.data.exportId : undefined;
}

export async function registerExportRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  exports: ExportService,
  auth: AuthService,
): Promise<void> {
  const requireRequestExport = async (
    request: FastifyRequest,
    exportId: string,
  ) => {
    const user = await requireUser(request, auth);
    return requireOwnedExport(projects, exports, user.id, exportId);
  };

  app.get("/v1/exports", async (request, reply) => {
    try {
      const user = await requireUser(request, auth);
      const ownedProjects = await projects.listOwnedByUser(user.id);
      return {
        data: await exports.listByProjectIds(
          ownedProjects.map((project) => project.id),
        ),
        error: null,
      };
    } catch (error) {
      return domainError(error, request, reply);
    }
  });

  app.post("/v1/exports", async (request, reply) => {
    let user;
    try {
      user = await requireUser(request, auth);
    } catch (error) {
      return domainError(error, request, reply);
    }

    const body = exportSchema.safeParse(request.body);
    if (!body.success) {
      return sendApiError(
        reply,
        request.id,
        400,
        "VALIDATION_FAILED",
        "إعدادات التصدير غير صالحة.",
      );
    }
    const project = await projects.findOwnedById(user.id, body.data.projectId);
    if (!project) {
      return sendProjectNotFound(reply, request.id);
    }
    try {
      const { selectedPage, documentRevision, ...exportInput } = body.data;
      const job = await exports.create(
        {
          ...exportInput,
          ...(selectedPage === undefined ? {} : { selectedPage }),
          ...(documentRevision === undefined ? {} : { documentRevision }),
        },
        project.kind,
        requestIdempotencyKey(request),
        async (queuedJob) =>
          Boolean(
            await projects.updateStatusForSource(
              project.id,
              queuedJob.sourceVersionId,
              "exporting",
              { type: "export", id: queuedJob.id },
            ),
          ),
      );
      if (job.status === "ready") {
        await projects.finishJobStatus(
          project.id,
          job.sourceVersionId,
          { type: "export", id: job.id },
          "completed",
        );
      }
      return reply.status(202).send({ data: job, error: null });
    } catch (error) {
      const failedJobId =
        error instanceof ExportDomainError || error instanceof ExportExecutionError
          ? error.jobId
          : undefined;
      if (failedJobId) {
        await projects.finishJobStatus(
          project.id,
          body.data.sourceVersionId,
          { type: "export", id: failedJobId },
          "failed",
        );
      }
      return domainError(error, request, reply);
    }
  });

  app.get("/v1/exports/:exportId", async (request, reply) => {
    return runResourceRoute(request, reply, {
      parseId: exportIdFrom,
      load: (exportId) => requireRequestExport(request, exportId),
      handle: (job) => ({ data: job, error: null }),
      onError: domainError,
    });
  });

  app.get("/v1/exports/:exportId/download", async (request, reply) => {
    return runResourceRoute(request, reply, {
      parseId: exportIdFrom,
      load: (exportId) => requireRequestExport(request, exportId),
      handle: async (job, exportId) => {
        const abortController = new AbortController();
        const abort = () => abortController.abort();
        const cleanup = () => {
          request.raw.removeListener("aborted", abort);
          reply.raw.removeListener("close", abort);
        };
        request.raw.once("aborted", abort);
        reply.raw.once("close", abort);
        let artifact;
        try {
          artifact = await exports.artifactStream(
            exportId,
            abortController.signal,
          );
        } catch (error) {
          cleanup();
          throw error;
        }
        artifact.body.once("close", cleanup);
        return reply
          .header("content-type", artifact.contentType)
          .header(
            "content-disposition",
            `attachment; filename="${job.artifact?.filename ?? "motionprep-export"}"`,
          )
          .header("content-length", artifact.sizeBytes)
          .send(artifact.body);
      },
      onError: domainError,
    });
  });

  app.post("/v1/exports/:exportId/cancel", async (request, reply) => {
    return runResourceRoute(request, reply, {
      parseId: exportIdFrom,
      load: (exportId) => requireRequestExport(request, exportId),
      handle: async (_job, exportId) => {
        const cancelled = await exports.cancel(exportId);
        await projects.finishJobStatus(
          cancelled.projectId,
          cancelled.sourceVersionId,
          { type: "export", id: cancelled.id },
          "needs_review",
        );
        return { data: cancelled, error: null };
      },
      onError: domainError,
    });
  });
}

async function requireOwnedExport(
  projects: ProjectRepository,
  exports: ExportService,
  userId: string,
  exportId: string,
): Promise<Awaited<ReturnType<ExportService["find"]>>> {
  const job = await exports.find(exportId);
  const project = await projects.findOwnedById(userId, job.projectId);
  if (!project) {
    throw new ExportDomainError(
      "EXPORT_NOT_FOUND",
      "مهمة التصدير غير موجودة.",
    );
  }
  return job;
}
