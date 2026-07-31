import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config.js";
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

export interface AppDependencies {
  projects?: ProjectRepository;
  uploads?: UploadRepository;
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
  adminAccess?: AdminAccessCommand;
  usageMeter?: UsageMeter;
  operationalStatus?: OperationalStatusProvider;
}

export async function buildApp(
  config: AppConfig,
  dependencies: AppDependencies = {},
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: config.NODE_ENV !== "test",
    bodyLimit: config.MAX_UPLOAD_BYTES,
    requestIdHeader: "x-request-id",
    trustProxy: config.TRUST_PROXY_HOPS || false,
  });

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
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    skipOnError: false,
  });
  await registerHttpMetrics(app, {
    ...(config.METRICS_BEARER_TOKEN
      ? { bearerToken: config.METRICS_BEARER_TOKEN }
      : {}),
    ...(dependencies.operationalStatus
      ? { operationalStatus: dependencies.operationalStatus }
      : {}),
    ...(dependencies.readiness ? { readiness: dependencies.readiness } : {}),
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
  const uploadService = new UploadService(
    uploadRepository,
    () => new Date(),
    idempotency,
    objectStorage,
    sourceVersionRepository,
  );
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

  const healthPayload = () => ({
    data: {
      status: "ok",
      service: "motionprep-api",
      timestamp: new Date().toISOString(),
    },
    error: null,
  });

  app.get("/v1/health", async () => healthPayload());
  app.get("/v1/health/live", async () => healthPayload());
  app.get("/v1/health/ready", async (_request, reply) => {
    try {
      await dependencies.readiness?.();
      return healthPayload();
    } catch {
      return reply.status(503).send({
        data: {
          status: "degraded",
          service: "motionprep-api",
          timestamp: new Date().toISOString(),
        },
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "إحدى خدمات التخزين المطلوبة غير جاهزة.",
        },
      });
    }
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
  await registerUploadRoutes(app, projects, uploadService, authService);
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
    billing: billingRepository,
    projects,
    ...(dependencies.adminAccess ? { access: dependencies.adminAccess } : {}),
    ...(dependencies.operationalStatus
      ? { operationalStatus: dependencies.operationalStatus }
      : {}),
  });

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
