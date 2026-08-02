import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import { isCookieMutationOriginAllowed } from "./http/cookie-mutation-origin.js";
import { registerHealthRoutes } from "./http/health-routes.js";
import {
  InMemoryProjectRepository,
  type ProjectRepository,
} from "./projects/project-repository.js";
import { registerProjectRoutes } from "./projects/project-routes.js";
import { registerUploadRoutes } from "./uploads/upload-routes.js";
import {
  InMemoryUploadRepository,
  type UploadRepository,
} from "./uploads/upload-repository.js";
import { UploadService } from "./uploads/upload-service.js";
import {
  InMemoryUploadFinalizationCommand,
  type UploadFinalizationCommand,
} from "./uploads/upload-finalization.js";
import {
  InMemoryExportRepository,
  type ExportRepository,
} from "./exports/export-repository.js";
import { ExportService } from "./exports/export-service.js";
import { registerExportRoutes } from "./exports/export-routes.js";
import {
  InMemoryAuthRepository,
  type AuthRepository,
} from "./auth/auth-repository.js";
import { AuthService } from "./auth/auth-service.js";
import { registerAuthRoutes } from "./auth/auth-routes.js";
import {
  InMemoryAuditRepository,
  type AuditRepository,
} from "./audit/audit-repository.js";
import { AuditService } from "./audit/audit-service.js";
import {
  InMemoryBillingRepository,
  type BillingRepository,
} from "./billing/billing-repository.js";
import { SandboxPaymentProvider } from "./billing/payment-provider.js";
import { BillingService } from "./billing/billing-service.js";
import { registerBillingRoutes } from "./billing/billing-routes.js";
import { registerAdminRoutes } from "./admin/admin-routes.js";
import {
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from "./idempotency/idempotency-store.js";
import type { LoginAttemptStore } from "./auth/login-attempt-store.js";
import {
  InMemoryObjectStorage,
  type ObjectStorage,
} from "./storage/object-storage.js";
import {
  InMemoryLayerDocumentRepository,
  InMemoryProcessingJobRepository,
  type LayerDocumentRepository,
  type ProcessingJobRepository,
} from "./processing/processing-repository.js";
import { ProcessingService } from "./processing/processing-service.js";
import { registerProcessingRoutes } from "./processing/processing-routes.js";
import type { EmailSender } from "./auth/email-sender.js";
import type { SecretProtector } from "./auth/secret-protector.js";
import type { PaymentProvider } from "./billing/payment-provider.js";
import type { PdfOcrEngine } from "@motionprep/document-processing";
import {
  InMemorySourceVersionRepository,
  type SourceVersionRepository,
} from "./sources/source-version-repository.js";
import { registerHttpMetrics } from "./observability/http-metrics.js";
import type { AdminAccessCommand } from "./admin/admin-access-command.js";
import {
  RepositoryUsageMeter,
  type UsageMeter,
} from "./billing/usage-meter.js";
import type { OperationalStatusProvider } from "./observability/operational-status.js";
import {
  InMemorySourceVersionRestoreCommand,
  type SourceVersionRestoreCommand,
} from "./sources/source-version-restore.js";
import { registerCapabilityRoutes } from "./capabilities/capability-routes.js";
import type { RateLimitStoreConstructor } from "./infrastructure/redis/redis-rate-limit-store.js";
import {
  registerOpenApiDefaults,
  transformOpenApiDocumentation,
} from "./http/openapi-defaults.js";
import { UploadReconciler } from "./uploads/upload-reconciler.js";
import { registerHttpErrorHandler } from "./http/error-handler.js";
import { registerHttpTracing } from "./observability/tracing.js";

const APPLICATION_VERSION = "0.1.3";

export interface AppDependencies {
  projects?: ProjectRepository;
  uploads?: UploadRepository;
  uploadFinalization?: UploadFinalizationCommand;
  sourceVersions?: SourceVersionRepository;
  sourceVersionRestores?: SourceVersionRestoreCommand;
  exports?: ExportRepository;
  auth?: AuthRepository;
  audit?: AuditRepository;
  billing?: BillingRepository;
  idempotency?: IdempotencyStore;
  loginAttempts?: LoginAttemptStore;
  objectStorage?: ObjectStorage;
  processingJobs?: ProcessingJobRepository;
  layerDocuments?: LayerDocumentRepository;
  emailSender?: EmailSender;
  secretProtector?: SecretProtector;
  paymentProviders?: PaymentProvider[];
  pdfOcrEngine?: PdfOcrEngine;
  readiness?: () => Promise<void>;
  dependencyReadiness?: Readonly<Record<string, () => Promise<void>>>;
  adminAccess?: AdminAccessCommand;
  usageMeter?: UsageMeter;
  operationalStatus?: OperationalStatusProvider;
  rateLimitStore?: RateLimitStoreConstructor;
}

export async function buildApp(
  config: AppConfig,
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
    bodyLimit: config.MAX_UPLOAD_BYTES,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    trustProxy: config.TRUST_PROXY_HOPS || false,
  });
  registerHttpTracing(app);

  await app.register(helmet, {
    hsts:
      config.NODE_ENV === "production"
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
  });
  const allowedWebOrigins = new Set([new URL(config.WEB_ORIGIN).origin]);
  if (config.NODE_ENV !== "production") {
    const configured = new URL(config.WEB_ORIGIN);
    for (const hostname of ["localhost", "127.0.0.1"]) {
      configured.hostname = hostname;
      allowedWebOrigins.add(configured.origin);
    }
  }
  await app.register(cors, {
    origin: [...allowedWebOrigins],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  app.addHook("onRequest", async (request, reply) => {
    if (
      !isCookieMutationOriginAllowed({
        method: request.method,
        hasSessionCookie: Boolean(request.cookies.motionprep_session),
        ...(request.headers.origin
          ? { origin: request.headers.origin }
          : {}),
        ...(request.headers.referer
          ? { referer: request.headers.referer }
          : {}),
        allowedOrigins: allowedWebOrigins,
        requireOrigin: config.NODE_ENV === "production",
      })
    ) {
      return reply.status(403).send({
        data: null,
        error: {
          code: "CROSS_ORIGIN_MUTATION_BLOCKED",
          message: "رُفض الطلب لأن مصدره لا يطابق واجهة التطبيق الموثوقة.",
          requestId: request.id,
        },
      });
    }
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    skipOnError: false,
    ...(dependencies.rateLimitStore
      ? { store: dependencies.rateLimitStore }
      : {}),
    nameSpace: "motionprep:rate-limit:",
    errorResponseBuilder: (request, context) => ({
      data: null,
      error: {
        code: "RATE_LIMITED",
        message: `تجاوزت حد الطلبات. أعد المحاولة بعد ${context.after}.`,
        requestId: request.id,
      },
    }),
  });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    if (
      !reply.hasHeader("cache-control") &&
      (request.url.startsWith("/v1/") || request.url.startsWith("/internal/"))
    ) {
      reply.header("cache-control", "no-store");
    }
    return payload;
  });
  await app.register(swagger, {
    transform: transformOpenApiDocumentation,
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "MotionPrep Studio API",
        description:
          "HTTP API for authentication, source preparation, layered editing, exports, billing, and administration.",
        version: APPLICATION_VERSION,
      },
      servers: [{ url: new URL(config.WEB_ORIGIN).origin }],
      tags: [
        { name: "health" },
        { name: "auth" },
        { name: "projects" },
        { name: "uploads" },
        { name: "processing" },
        { name: "exports" },
        { name: "billing" },
        { name: "admin" },
        { name: "system" },
      ],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: "apiKey",
            in: "cookie",
            name: "motionprep_session",
          },
          providerSignature: {
            type: "apiKey",
            in: "header",
            name: "stripe-signature",
          },
        },
        schemas: {
          ApiErrorEnvelope: {
            type: "object",
            required: ["data", "error"],
            properties: {
              data: { type: "null" },
              error: {
                type: "object",
                required: ["code", "message", "requestId"],
                properties: {
                  code: { type: "string" },
                  message: { type: "string" },
                  requestId: { type: "string" },
                  fields: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  },
                },
              },
            },
          },
        },
        responses: Object.fromEntries(
          [
            ["BadRequest", "The request is invalid."],
            ["Unauthorized", "Authentication is required."],
            ["Forbidden", "The authenticated user is not authorized."],
            ["Conflict", "The request conflicts with current state."],
            ["RateLimited", "The request rate limit was exceeded."],
            ["InternalError", "An unexpected server error occurred."],
          ].map(([name, description]) => [
            name,
            {
              description,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                },
              },
            },
          ]),
        ),
      },
    },
  });
  registerOpenApiDefaults(app);
  await registerHttpMetrics(app, {
    ...(config.METRICS_BEARER_TOKEN
      ? { bearerToken: config.METRICS_BEARER_TOKEN }
      : {}),
    ...(dependencies.operationalStatus
      ? { operationalStatus: dependencies.operationalStatus }
      : {}),
    ...(dependencies.readiness ? { readiness: dependencies.readiness } : {}),
    ...(dependencies.dependencyReadiness
      ? { dependencyReadiness: dependencies.dependencyReadiness }
      : {}),
    buildInfo: {
      version: APPLICATION_VERSION,
      release: process.env.RELEASE_VERSION ?? "development",
    },
  });

  const projects = dependencies.projects ?? new InMemoryProjectRepository();
  const idempotency =
    dependencies.idempotency ?? new InMemoryIdempotencyStore();
  const uploadRepository =
    dependencies.uploads ?? new InMemoryUploadRepository();
  const sourceVersionRepository =
    dependencies.sourceVersions ?? new InMemorySourceVersionRepository();
  const sourceVersionRestores =
    dependencies.sourceVersionRestores ??
    new InMemorySourceVersionRestoreCommand(
      projects,
      sourceVersionRepository,
    );
  const objectStorage =
    dependencies.objectStorage ?? new InMemoryObjectStorage();
  const uploadFinalization =
    dependencies.uploadFinalization ??
    new InMemoryUploadFinalizationCommand(
      uploadRepository,
      sourceVersionRepository,
      projects,
    );
  const uploadService = new UploadService(
    uploadRepository,
    () => new Date(),
    idempotency,
    objectStorage,
    sourceVersionRepository,
    uploadFinalization,
    config.MAX_UPLOAD_BYTES,
  );
  const uploadReconciler = new UploadReconciler(
    uploadFinalization,
    objectStorage,
    (report) => {
      if (report.inspected > 0) {
        app.log.info(report, "upload.reconciliation_completed");
      }
    },
  );
  if (config.NODE_ENV === "production") {
    app.addHook("onReady", async () => uploadReconciler.start());
    app.addHook("onClose", async () => uploadReconciler.stop());
  }
  const exportRepository =
    dependencies.exports ?? new InMemoryExportRepository();
  const layerDocumentRepository =
    dependencies.layerDocuments ?? new InMemoryLayerDocumentRepository();
  const exportService = new ExportService(
    exportRepository,
    () => new Date(),
    idempotency,
    uploadRepository,
    objectStorage,
    layerDocumentRepository,
    config.EXPORT_EXECUTION_MODE === "inline",
  );
  const billingRepository =
    dependencies.billing ?? new InMemoryBillingRepository();
  const usageMeter =
    dependencies.usageMeter ??
    new RepositoryUsageMeter(
      billingRepository,
      config.USAGE_METERING_MODE,
    );
  const processingJobRepository =
    dependencies.processingJobs ?? new InMemoryProcessingJobRepository();
  const processingService = new ProcessingService(
    processingJobRepository,
    layerDocumentRepository,
    uploadRepository,
    objectStorage,
    () => new Date(),
    idempotency,
    config.PROCESSING_EXECUTION_MODE === "inline",
    dependencies.pdfOcrEngine,
    usageMeter,
  );
  const authRepository = dependencies.auth ?? new InMemoryAuthRepository();
  const authService = new AuthService(
    authRepository,
    () => new Date(),
    config.SESSION_TTL_SECONDS,
    dependencies.loginAttempts,
    {
      ...(dependencies.emailSender
        ? { emailSender: dependencies.emailSender }
        : {}),
      ...(dependencies.secretProtector
        ? { secretProtector: dependencies.secretProtector }
        : {}),
      passwordResetUrl:
        config.PASSWORD_RESET_URL ??
        new URL("/auth/reset", config.WEB_ORIGIN).toString(),
      totpIssuer: config.TOTP_ISSUER,
    },
  );
  const auditRepository =
    dependencies.audit ?? new InMemoryAuditRepository();
  const auditService = new AuditService(auditRepository);
  const billingService = new BillingService(
    billingRepository,
    dependencies.paymentProviders ??
      (config.PAYMENT_MODE === "sandbox"
        ? [
            new SandboxPaymentProvider("sandbox-card"),
            new SandboxPaymentProvider("sandbox-local"),
          ]
        : []),
    auditService,
    () => new Date(),
    idempotency,
  );

  registerHealthRoutes(app, {
    applicationVersion: APPLICATION_VERSION,
    release: config.RELEASE_VERSION,
    readiness: dependencies.readiness,
  });
  app.get(
    "/v1/openapi.json",
    { schema: { hide: true } },
    async (_request, reply) => reply.type("application/json").send(app.swagger()),
  );

  await registerCapabilityRoutes(app, {
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
    pdfRegionOcrEnabled: config.PDF_REGION_OCR_ENABLED,
  });

  await registerAuthRoutes(app, authService, {
    secureCookies: config.COOKIE_SECURE,
    sessionTtlSeconds: config.SESSION_TTL_SECONDS,
  });
  await registerProjectRoutes(
    app,
    projects,
    authService,
    sourceVersionRepository,
    sourceVersionRestores,
  );
  await registerUploadRoutes(app, projects, uploadService, authService, {
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
  });
  await registerExportRoutes(app, projects, exportService, authService);
  await registerProcessingRoutes(
    app,
    projects,
    processingService,
    authService,
    { pdfRegionOcrEnabled: config.PDF_REGION_OCR_ENABLED },
  );
  await registerBillingRoutes(app, authService, billingService, {
    allowedReturnOrigin: new URL(config.WEB_ORIGIN).origin,
    sandbox: config.PAYMENT_MODE === "sandbox",
    mode: config.PAYMENT_MODE,
  });
  await registerAdminRoutes(app, {
    auth: authService,
    audit: auditService,
    uploads: uploadRepository,
    exports: exportRepository,
    processingJobs: processingJobRepository,
    layerDocuments: layerDocumentRepository,
    billing: billingRepository,
    projects,
    ...(dependencies.adminAccess ? { access: dependencies.adminAccess } : {}),
    ...(dependencies.operationalStatus
      ? { operationalStatus: dependencies.operationalStatus }
      : {}),
  });

  registerHttpErrorHandler(app);

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      data: null,
      error: {
        code: "NOT_FOUND",
        message: "المورد المطلوب غير موجود.",
        requestId: request.id,
      },
    }),
  );

  return app;
}
