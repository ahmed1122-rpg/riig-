import type { UserRole, UserStatus } from "@motionprep/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuditService } from "../audit/audit-service.js";
import { requireRole } from "../auth/authorize.js";
import { AuthDomainError, type AuthService } from "../auth/auth-service.js";
import type { ExportRepository } from "../exports/export-repository.js";
import type { BillingRepository } from "../billing/billing-repository.js";
import {
  toAdminExportJobDto,
  toAdminProcessingJobDto,
} from "../jobs/job-dtos.js";
import type { ProcessingJobRepository } from "../processing/processing-repository.js";
import type { LayerDocumentRepository } from "../processing/processing-repository.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import type { AdminAccessCommand } from "./admin-access-command.js";
import type { OperationalStatusProvider } from "../observability/operational-status.js";
import type { ProjectRepository } from "../projects/project-repository.js";

const updateUserSchema = z
  .object({
    role: z.enum(["creator", "support", "finance", "admin"]).optional(),
    status: z.enum(["active", "suspended", "pending_verification"]).optional(),
    reason: z.string().trim().min(10).max(500),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined);

const userParamsSchema = z.object({ userId: z.string().uuid() });
const processingParamsSchema = z.object({ jobId: z.string().uuid() });
const retryProcessingSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});

function adminError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!(error instanceof AuthDomainError)) throw error;
  const status = error.code === "USER_NOT_FOUND" ? 404 : 403;
  return reply.status(status).send({
    data: null,
    error: {
      code: error.code,
      message: error.message,
      requestId: request.id,
    },
  });
}

export async function registerAdminRoutes(
  app: FastifyInstance,
  dependencies: {
    auth: AuthService;
    audit: AuditService;
    uploads: UploadRepository;
    exports: ExportRepository;
    processingJobs: ProcessingJobRepository;
    layerDocuments: LayerDocumentRepository;
    billing: BillingRepository;
    access?: AdminAccessCommand;
    operationalStatus?: OperationalStatusProvider;
    projects: ProjectRepository;
  },
): Promise<void> {
  app.get("/v1/admin/overview", async (request, reply) => {
    try {
      await requireRole(request, dependencies.auth, [
        "support",
        "finance",
        "admin",
      ]);
      const [users, uploads, exports, processing, billing, audit] =
        await Promise.all([
        dependencies.auth.listUsers(),
        dependencies.uploads.summarizeStatuses(),
        dependencies.exports.summarizeStatuses(),
        dependencies.processingJobs.summarizeStatuses(),
        dependencies.billing.summarizeStatuses(),
        dependencies.audit.list(10),
      ]);
      return {
        data: {
          users: {
            total: users.length,
            active: users.filter((user) => user.status === "active").length,
            suspended: users.filter((user) => user.status === "suspended")
              .length,
          },
          uploads,
          exports,
          processing,
          billing,
          audit,
        },
        error: null,
      };
    } catch (error) {
      return adminError(error, request, reply);
    }
  });

  app.get("/v1/admin/processing", async (request, reply) => {
    try {
      await requireRole(request, dependencies.auth, ["support", "admin"]);
      return {
        data: (await dependencies.processingJobs.list(200)).map(
          toAdminProcessingJobDto,
        ),
        error: null,
      };
    } catch (error) {
      return adminError(error, request, reply);
    }
  });

  app.get("/v1/admin/exports", async (request, reply) => {
    try {
      await requireRole(request, dependencies.auth, ["support", "admin"]);
      return {
        data: (await dependencies.exports.list(200)).map(toAdminExportJobDto),
        error: null,
      };
    } catch (error) {
      return adminError(error, request, reply);
    }
  });

  app.post("/v1/admin/processing/:jobId/retry", async (request, reply) => {
    const params = processingParamsSchema.safeParse(request.params);
    const body = retryProcessingSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        data: null,
        error: {
          code: "VALIDATION_FAILED",
          message: "سبب إعادة المحاولة أو معرّف المهمة غير صالح.",
          requestId: request.id,
        },
      });
    }
    try {
      const actor = await requireRole(request, dependencies.auth, ["admin"]);
      const job = await dependencies.processingJobs.findById(params.data.jobId);
      if (!job) {
        return reply.status(404).send({
          data: null,
          error: {
            code: "PROCESSING_JOB_NOT_FOUND",
            message: "مهمة المعالجة غير موجودة.",
            requestId: request.id,
          },
        });
      }
      const source = await dependencies.uploads.findReadyBySourceVersion(
        job.projectId,
        job.sourceVersionId,
      );
      if (job.status !== "failed" || !source) {
        return reply.status(409).send({
          data: null,
          error: {
            code: "PROCESSING_JOB_NOT_RETRYABLE",
            message: "لا يمكن إعادة هذه المهمة؛ يجب أن تكون فاشلة ومصدرها جاهزًا.",
            requestId: request.id,
          },
        });
      }
      const activated = await dependencies.projects.updateStatusForSource(
        job.projectId,
        job.sourceVersionId,
        "queued",
        { type: "processing", id: job.id },
      );
      if (!activated) {
        return reply.status(409).send({
          data: null,
          error: {
            code: "PROCESSING_SOURCE_NOT_CURRENT",
            message: "لم يعد مصدر المهمة هو الإصدار الحالي للمشروع.",
            requestId: request.id,
          },
        });
      }
      const retried = await dependencies.processingJobs.retryFailed(
        job.id,
        new Date().toISOString(),
      );
      if (!retried) {
        const concurrentlyRetried = await dependencies.processingJobs.findById(
          job.id,
        );
        if (
          concurrentlyRetried &&
          ["queued", "processing", "verifying", "ready"].includes(
            concurrentlyRetried.status,
          )
        ) {
          return {
            data: toAdminProcessingJobDto(concurrentlyRetried),
            error: null,
          };
        }
        await dependencies.projects.finishJobStatus(
          job.projectId,
          job.sourceVersionId,
          { type: "processing", id: job.id },
          "failed",
        );
        return reply.status(409).send({
          data: null,
          error: {
            code: "PROCESSING_JOB_NOT_RETRYABLE",
            message: "تغيرت حالة المهمة قبل إعادة المحاولة.",
            requestId: request.id,
          },
        });
      }
      await dependencies.audit.record({
        actorUserId: actor.id,
        action: "admin.processing.retry_requested",
        targetType: "processing_job",
        targetId: retried.id,
        outcome: "success",
        reason: body.data.reason,
        requestId: request.id,
      });
      return { data: toAdminProcessingJobDto(retried), error: null };
    } catch (error) {
      return adminError(error, request, reply);
    }
  });

  app.post("/v1/admin/exports/:jobId/retry", async (request, reply) => {
    const params = processingParamsSchema.safeParse(request.params);
    const body = retryProcessingSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        data: null,
        error: {
          code: "VALIDATION_FAILED",
          message: "A valid export job and a retry reason are required.",
          requestId: request.id,
        },
      });
    }
    try {
      const actor = await requireRole(request, dependencies.auth, ["admin"]);
      const job = await dependencies.exports.findById(params.data.jobId);
      if (!job) {
        return reply.status(404).send({
          data: null,
          error: {
            code: "EXPORT_JOB_NOT_FOUND",
            message: "Export job not found.",
            requestId: request.id,
          },
        });
      }
      const [source, document] = await Promise.all([
        dependencies.uploads.findReadyBySourceVersion(
          job.projectId,
          job.sourceVersionId,
        ),
        dependencies.layerDocuments.findRevision(
          job.projectId,
          job.sourceVersionId,
          job.documentRevision ?? 1,
        ),
      ]);
      if (job.status !== "failed" || !source || !document) {
        return reply.status(409).send({
          data: null,
          error: {
            code: "EXPORT_JOB_NOT_RETRYABLE",
            message:
              "The export must be failed and retain its ready source and document revision.",
            requestId: request.id,
          },
        });
      }
      const activated = await dependencies.projects.updateStatusForSource(
        job.projectId,
        job.sourceVersionId,
        "exporting",
        { type: "export", id: job.id },
      );
      if (!activated) {
        return reply.status(409).send({
          data: null,
          error: {
            code: "EXPORT_SOURCE_NOT_CURRENT",
            message: "The export source is no longer the project's current source.",
            requestId: request.id,
          },
        });
      }
      const retried = await dependencies.exports.retryFailed(
        job.id,
        new Date().toISOString(),
      );
      if (!retried) {
        const concurrentlyRetried = await dependencies.exports.findById(job.id);
        if (
          concurrentlyRetried &&
          ["queued", "generating", "verifying", "ready"].includes(
            concurrentlyRetried.status,
          )
        ) {
          return {
            data: toAdminExportJobDto(concurrentlyRetried),
            error: null,
          };
        }
        await dependencies.projects.finishJobStatus(
          job.projectId,
          job.sourceVersionId,
          { type: "export", id: job.id },
          "failed",
          job.documentRevision,
        );
        return reply.status(409).send({
          data: null,
          error: {
            code: "EXPORT_JOB_NOT_RETRYABLE",
            message: "The export state changed before the retry was committed.",
            requestId: request.id,
          },
        });
      }
      await dependencies.audit.record({
        actorUserId: actor.id,
        action: "admin.export.retry_requested",
        targetType: "export_job",
        targetId: retried.id,
        outcome: "success",
        reason: body.data.reason,
        requestId: request.id,
      });
      return { data: toAdminExportJobDto(retried), error: null };
    } catch (error) {
      return adminError(error, request, reply);
    }
  });

  app.get("/v1/admin/system", async (request, reply) => {
    try {
      await requireRole(request, dependencies.auth, ["support", "admin"]);
      if (!dependencies.operationalStatus) {
        return {
          data: {
            status: "degraded" as const,
            workers: [],
            queues: [],
            emailOutbox: null,
            maintenance: null,
            checkedAt: new Date().toISOString(),
          },
          error: null,
        };
      }
      return {
        data: await dependencies.operationalStatus.snapshot(),
        error: null,
      };
    } catch (error) {
      return adminError(error, request, reply);
    }
  });

  app.get("/v1/admin/billing", async (request, reply) => {
    try {
      await requireRole(request, dependencies.auth, ["finance", "admin"]);
      const [subscriptions, checkouts] = await Promise.all([
        dependencies.billing.listSubscriptions(200),
        dependencies.billing.listCheckouts(200),
      ]);
      return {
        data: {
          subscriptions,
          checkouts: checkouts.map(({ checkoutUrl: _checkoutUrl, ...checkout }) => checkout),
        },
        error: null,
      };
    } catch (error) {
      return adminError(error, request, reply);
    }
  });

  app.get("/v1/admin/users", async (request, reply) => {
    try {
      await requireRole(request, dependencies.auth, ["support", "admin"]);
      return { data: await dependencies.auth.listUsers(), error: null };
    } catch (error) {
      return adminError(error, request, reply);
    }
  });

  app.patch("/v1/admin/users/:userId/access", async (request, reply) => {
    const params = userParamsSchema.safeParse(request.params);
    const body = updateUserSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        data: null,
        error: {
          code: "VALIDATION_FAILED",
          message: "بيانات تعديل الصلاحية غير صالحة.",
          requestId: request.id,
        },
      });
    }
    try {
      const actor = await requireRole(request, dependencies.auth, ["admin"]);
      const changes: { role?: UserRole; status?: UserStatus } = {};
      if (body.data.role !== undefined) changes.role = body.data.role;
      if (body.data.status !== undefined) changes.status = body.data.status;
      const updated = dependencies.access
        ? await dependencies.access.update({
            actor,
            userId: params.data.userId,
            changes,
            reason: body.data.reason,
            requestId: request.id,
          })
        : await updateAccessWithAudit(
            dependencies,
            actor,
            params.data.userId,
            changes,
            body.data.reason,
            request.id,
          );
      return { data: updated, error: null };
    } catch (error) {
      return adminError(error, request, reply);
    }
  });

  app.get("/v1/admin/audit", async (request, reply) => {
    try {
      await requireRole(request, dependencies.auth, [
        "support",
        "finance",
        "admin",
      ]);
      return { data: await dependencies.audit.list(200), error: null };
    } catch (error) {
      return adminError(error, request, reply);
    }
  });
}

async function updateAccessWithAudit(
  dependencies: {
    auth: AuthService;
    audit: AuditService;
  },
  actor: Awaited<ReturnType<typeof requireRole>>,
  userId: string,
  changes: { role?: UserRole; status?: UserStatus },
  reason: string,
  requestId: string,
) {
  const updated = await dependencies.auth.updateUserAccess(
    actor,
    userId,
    changes,
  );
  await dependencies.audit.record({
    actorUserId: actor.id,
    action: "admin.user.access_updated",
    targetType: "user",
    targetId: updated.id,
    outcome: "success",
    reason,
    requestId,
  });
  return updated;
}
