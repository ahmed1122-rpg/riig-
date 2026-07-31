import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_MEBIBYTES,
  acceptedSourceTypes,
} from "@motionprep/contracts";
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
import { UploadDomainError, type UploadService } from "./upload-service.js";

const uploadIntentSchema = z.object({
  projectId: z.string().uuid(),
  filename: z.string().trim().min(1).max(255),
  contentType: z.enum(acceptedSourceTypes),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
  replaceSourceVersion: z.boolean().optional(),
});

const uploadParamsSchema = z.object({ uploadId: z.string().uuid() });

const domainError = createDomainErrorResponder(
  UploadDomainError,
  (code) =>
    code === "UPLOAD_NOT_FOUND"
      ? 404
      : code === "UPLOAD_STORAGE_MISMATCH"
        ? 502
      : code === "ACTIVE_UPLOAD_EXISTS" ||
          code === "UPLOAD_REQUEST_IN_PROGRESS"
        ? 409
        : 400,
);

function uploadIdFrom(params: unknown): string | undefined {
  const parsed = uploadParamsSchema.safeParse(params);
  return parsed.success ? parsed.data.uploadId : undefined;
}

export async function registerUploadRoutes(
  app: FastifyInstance,
  projects: ProjectRepository,
  uploads: UploadService,
  auth: AuthService,
): Promise<void> {
  const requireRequestUpload = async (
    request: FastifyRequest,
    uploadId: string,
  ) => {
    const user = await requireUser(request, auth);
    await requireOwnedUpload(projects, uploads, user.id, uploadId);
  };
  const persistReadyUpload = async (
    operation: () => ReturnType<UploadService["receive"]>,
  ) => {
    const session = await operation();
    await markSourceReady(
      projects,
      uploads,
      session.projectId,
      session.uploadId,
    );
    return session;
  };

  app.addContentTypeParser(
    [...acceptedSourceTypes],
    { parseAs: "buffer", bodyLimit: MAX_UPLOAD_BYTES },
    (_request, body, done) => done(null, body),
  );

  app.post("/v1/uploads/intents", async (request, reply) => {
    let user;
    try {
      user = await requireUser(request, auth);
    } catch (error) {
      return domainError(error, request, reply);
    }

    const parsed = uploadIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendApiError(
        reply,
        request.id,
        400,
        "UPLOAD_REJECTED",
        `الملف غير مدعوم أو يتجاوز الحد الأقصى ${MAX_UPLOAD_MEBIBYTES} MiB.`,
      );
    }

    const project = await projects.findOwnedById(
      user.id,
      parsed.data.projectId,
    );
    if (!project) {
      return sendProjectNotFound(reply, request.id);
    }

    if (
      project.currentSourceVersionId &&
      parsed.data.replaceSourceVersion !== true
    ) {
      return sendApiError(
        reply,
        request.id,
        409,
        "SOURCE_REPLACEMENT_CONFIRMATION_REQUIRED",
        "يتطلب استبدال المصدر الحالي تأكيدًا صريحًا.",
      );
    }

    const inputMatchesProject =
      (project.kind === "book" &&
        parsed.data.contentType === "application/pdf") ||
      (project.kind === "image" &&
        parsed.data.contentType.startsWith("image/"));
    if (!inputMatchesProject) {
      return sendApiError(
        reply,
        request.id,
        400,
        "SOURCE_KIND_MISMATCH",
        "نوع الملف لا يطابق نوع المشروع.",
      );
    }

    try {
      const intentInput = {
        projectId: parsed.data.projectId,
        filename: parsed.data.filename,
        contentType: parsed.data.contentType,
        sizeBytes: parsed.data.sizeBytes,
        ...(parsed.data.replaceSourceVersion === undefined
          ? {}
          : { replaceSourceVersion: parsed.data.replaceSourceVersion }),
      };
      const session = await uploads.createIntent(
        intentInput,
        requestIdempotencyKey(request),
      );
      await projects.updateStatus(session.projectId, "uploading");
      return reply.status(201).send({ data: session, error: null });
    } catch (error) {
      return domainError(error, request, reply);
    }
  });

  app.get("/v1/uploads/:uploadId", async (request, reply) => {
    return runResourceRoute(request, reply, {
      parseId: uploadIdFrom,
      load: async (uploadId) => {
        await requireRequestUpload(request, uploadId);
        return uploads.find(uploadId);
      },
      handle: (session) => ({ data: session, error: null }),
      onError: domainError,
    });
  });

  app.put("/v1/uploads/:uploadId/content", async (request, reply) => {
    const params = uploadParamsSchema.safeParse(request.params);
    const content = request.body;
    if (!params.success || !Buffer.isBuffer(content)) {
      return sendApiError(
        reply,
        request.id,
        400,
        "UPLOAD_CONTENT_INVALID",
        "محتوى الرفع غير صالح.",
      );
    }
    try {
      await requireRequestUpload(request, params.data.uploadId);
      const session = await persistReadyUpload(() =>
        uploads.receive(params.data.uploadId, content),
      );
      return { data: session, error: null };
    } catch (error) {
      return domainError(error, request, reply);
    }
  });

  app.post("/v1/uploads/:uploadId/cancel", async (request, reply) => {
    return runResourceRoute(request, reply, {
      parseId: uploadIdFrom,
      load: async (uploadId) => {
        await requireRequestUpload(request, uploadId);
        return uploads.find(uploadId);
      },
      handle: async (_session, uploadId) => ({
        data: await uploads.cancel(uploadId),
        error: null,
      }),
      onError: domainError,
    });
  });
}

async function markSourceReady(
  projects: ProjectRepository,
  uploads: UploadService,
  projectId: string,
  uploadId: string,
): Promise<void> {
  const sourceVersion = await uploads.findSourceVersion(uploadId);
  if (!sourceVersion || sourceVersion.status !== "ready") {
    throw new Error("Ready upload is missing its source version.");
  }
  await projects.updateCurrentSourceVersion(
    projectId,
    sourceVersion.id,
    sourceVersion.versionNumber,
  );
  await projects.updateStatus(projectId, "queued");
}

async function requireOwnedUpload(
  projects: ProjectRepository,
  uploads: UploadService,
  userId: string,
  uploadId: string,
): Promise<void> {
  const session = await uploads.find(uploadId);
  const project = await projects.findOwnedById(userId, session.projectId);
  if (!project) {
    throw new UploadDomainError(
      "UPLOAD_NOT_FOUND",
      "جلسة الرفع غير موجودة.",
    );
  }
}
