import type { UserRole, UserStatus } from "@motionprep/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuditService } from "../audit/audit-service.js";
import { requireRole } from "../auth/authorize.js";
import { AuthDomainError, type AuthService } from "../auth/auth-service.js";
import type { ExportRepository } from "../exports/export-repository.js";
import type { BillingRepository } from "../billing/billing-repository.js";
import type { ProcessingJobRepository } from "../processing/processing-repository.js";
import type { UploadRepository } from "../uploads/upload-repository.js";
import type { AdminAccessCommand } from "./admin-access-command.js";
import type { OperationalStatusProvider } from "../observability/operational-status.js";

const updateUserSchema = z
  .object({
    role: z.enum(["creator", "support", "finance", "admin"]).optional(),
    status: z.enum(["active", "suspended", "pending_verification"]).optional(),
    reason: z.string().trim().min(10).max(500),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined);

const userParamsSchema = z.object({ userId: z.string().uuid() });

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
    billing: BillingRepository;
    access?: AdminAccessCommand;
    operationalStatus?: OperationalStatusProvider;
  },
): Promise<void> {
  app.get("/v1/admin/overview", async (request, reply) => {
    try {
      await requireRole(request, dependencies.auth, [
        "support",
        "finance",
        "admin",
      ]);
      const [users, uploads, exports, jobs, subscriptions, checkouts, audit] =
        await Promise.all([
        dependencies.auth.listUsers(),
        dependencies.uploads.list(),
        dependencies.exports.list(),
        dependencies.processingJobs.list(200),
        dependencies.billing.listSubscriptions(200),
        dependencies.billing.listCheckouts(200),
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
          uploads: {
            total: uploads.length,
            active: uploads.filter((upload) =>
              ["validating", "uploading", "verifying"].includes(upload.status),
            ).length,
            failed: uploads.filter((upload) => upload.status === "failed")
              .length,
          },
          exports: {
            total: exports.length,
            queued: exports.filter((job) => job.status === "queued").length,
            failed: exports.filter((job) => job.status === "failed").length,
          },
          processing: {
            total: jobs.length,
            active: jobs.filter((job) =>
              ["queued", "processing", "verifying"].includes(job.status),
            ).length,
            failed: jobs.filter((job) => job.status === "failed").length,
          },
          billing: {
            activeSubscriptions: subscriptions.filter((subscription) =>
              ["active", "trialing"].includes(subscription.status),
            ).length,
            pendingCheckouts: checkouts.filter((checkout) =>
              ["pending", "redirect_required"].includes(checkout.status),
            ).length,
            paidCheckouts: checkouts.filter(
              (checkout) => checkout.status === "paid",
            ).length,
          },
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
        data: await dependencies.processingJobs.list(200),
        error: null,
      };
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
