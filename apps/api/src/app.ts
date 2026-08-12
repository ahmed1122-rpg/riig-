import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "./config.js";
import type { AppDependencies } from "./app-dependencies.js";
export type { AppDependencies } from "./app-dependencies.js";
import { isCookieMutationOriginAllowed } from "./http/cookie-mutation-origin.js";
import { registerHealthRoutes } from "./http/health-routes.js";
import { InMemoryProjectRepository } from "./projects/project-repository.js";
import { registerProjectRoutes } from "./projects/project-routes.js";
import { InMemoryProjectReviewCommand } from "./projects/project-review.js";
import { registerUploadRoutes } from "./uploads/upload-routes.js";
import { InMemoryUploadRepository } from "./uploads/upload-repository.js";
import { InMemoryExportRepository } from "./exports/export-repository.js";
import { ExportService } from "./exports/export-service.js";
import { registerExportRoutes } from "./exports/export-routes.js";
import { InMemoryAuthRepository } from "./auth/auth-repository.js";
import { AuthService } from "./auth/auth-service.js";
import { registerAuthRoutes } from "./auth/auth-routes.js";
import { InMemoryAuditRepository } from "./audit/audit-repository.js";
import { AuditService } from "./audit/audit-service.js";
import { InMemoryBillingRepository } from "./billing/billing-repository.js";
import { SandboxPaymentProvider } from "./billing/payment-provider.js";
import { BillingService } from "./billing/billing-service.js";
import { registerBillingRoutes } from "./billing/billing-routes.js";
import { registerAdminRoutes } from "./admin/admin-routes.js";
import { InMemoryIdempotencyStore } from "./idempotency/idempotency-store.js";
import { InMemoryObjectStorage } from "./storage/object-storage.js";
import {
  InMemoryLayerDocumentRepository,
  InMemoryProcessingJobRepository,
} from "./processing/processing-repository.js";
import { ProcessingService } from "./processing/processing-service.js";
import { registerProcessingRoutes } from "./processing/processing-routes.js";
import { InMemorySourceVersionRepository } from "./sources/source-version-repository.js";
import { registerHttpMetrics } from "./observability/http-metrics.js";
import { RepositoryUsageMeter } from "./billing/usage-meter.js";
import { InMemorySourceVersionRestoreCommand } from "./sources/source-version-restore.js";
import { registerCapabilityRoutes } from "./capabilities/capability-routes.js";
import {
  registerOpenApiDefaults,
  transformOpenApiDocumentation,
} from "./http/openapi-defaults.js";
import { UploadReconciliationMetrics } from "./uploads/upload-reconciliation-metrics.js";
import { createUploadRuntime } from "./uploads/upload-runtime.js";
import { registerHttpErrorHandler } from "./http/error-handler.js";
import { registerHttpTracing } from "./observability/tracing.js";
import { ActivityService } from "./activity/activity-service.js";
import { registerActivityRoutes } from "./activity/activity-routes.js";
import {
  AccountDeletionProcessor,
  AccountPrivacyService,
  InMemoryAccountPrivacyRepository,
} from "./privacy/account-privacy.js";
import { registerAccountPrivacyRoutes } from "./privacy/account-privacy-routes.js";
import { registerCharacterRigFeature } from "./character-rig/character-rig-feature.js";

const APPLICATION_VERSION = "0.1.3";

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
        { name: "account" },
        { name: "projects" },
        { name: "uploads" },
        { name: "processing" },
        { name: "character-rig" },
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
  const uploadReconciliationMetrics = new UploadReconciliationMetrics();
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
    ...(dependencies.metricsProbeTimeoutMs
      ? { probeTimeoutMs: dependencies.metricsProbeTimeoutMs }
      : {}),
    uploadReconciliationMetrics,
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
  const uploadRuntime = createUploadRuntime({
    uploads: uploadRepository,
    sourceVersions: sourceVersionRepository,
    projects,
    idempotency,
    storage: objectStorage,
    maxUploadBytes: config.MAX_UPLOAD_BYTES,
    metrics: uploadReconciliationMetrics,
    logger: app.log,
    ...(dependencies.uploadFinalization ? { finalization: dependencies.uploadFinalization } : {}),
    ...(dependencies.uploadIntegrityFailures ? { integrityFailures: dependencies.uploadIntegrityFailures } : {}),
    ...(dependencies.uploadCancellations ? { cancellations: dependencies.uploadCancellations } : {}),
  });
  if (config.NODE_ENV === "production") {
    app.addHook("onReady", async () => uploadRuntime.reconciler.start());
    app.addHook("onClose", async () => uploadRuntime.reconciler.stop());
  }
  const exportRepository =
    dependencies.exports ?? new InMemoryExportRepository();
  const layerDocumentRepository =
    dependencies.layerDocuments ?? new InMemoryLayerDocumentRepository();
  const projectReviews =
    dependencies.projectReviews ??
    new InMemoryProjectReviewCommand(projects, layerDocumentRepository);
  const exportService = new ExportService(
    exportRepository,
    () => new Date(),
    idempotency,
    uploadRepository,
    objectStorage,
    layerDocumentRepository,
    config.EXPORT_EXECUTION_MODE === "inline",
    (error, objectKey) => {
      app.log.error(
        { err: error, object_key: objectKey },
        "export.artifact_cleanup_failed",
      );
    },
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
    {
      ...(dependencies.pdfOcrEngine
        ? { pdfOcrEngine: dependencies.pdfOcrEngine }
        : {}),
      usageMeter,
      onAssetCleanupError: (error, objectKey) => {
        app.log.error(
          { err: error, object_key: objectKey },
          "processing.asset_cleanup_failed",
        );
      },
      rasterAssetWriteConcurrency: config.RASTER_ASSET_WRITE_CONCURRENCY,
      onAssetWriteObservation: (observation) => {
        app.log.info(
          {
            asset_count: observation.assetCount,
            stored_count: observation.storedCount,
            total_bytes: observation.totalBytes,
            duration_ms: observation.durationMs,
            concurrency: observation.concurrency,
            outcome: observation.outcome,
          },
          "processing.raster_asset_write_observed",
        );
      },
      onAssetWriteObservationError: (error) => {
        app.log.error(
          { err: error },
          "processing.raster_asset_observer_failed",
        );
      },
    },
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
      ...(config.E2E_ADMIN_EMAIL ? {
        registrationRoleForEmail: (email: string) =>
          email === config.E2E_ADMIN_EMAIL ? "admin" as const : "creator" as const,
      } : {}),
    },
  );
  const accountPrivacyRepository =
    dependencies.accountPrivacy ??
    new InMemoryAccountPrivacyRepository(authRepository);
  const accountPrivacyService = new AccountPrivacyService(
    accountPrivacyRepository,
    authService,
    new AccountDeletionProcessor(
      accountPrivacyRepository,
      objectStorage,
    ),
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
    characterRigEnabled: config.CHARACTER_RIG_ENABLED,
  });

  await registerAuthRoutes(app, authService, {
    secureCookies: config.COOKIE_SECURE,
    sessionTtlSeconds: config.SESSION_TTL_SECONDS,
  });
  await registerAccountPrivacyRoutes(app, authService, accountPrivacyService);
  await registerProjectRoutes(
    app,
    projects,
    authService,
    sourceVersionRepository,
    sourceVersionRestores,
    projectReviews,
  );
  await registerCharacterRigFeature(app, {
    projects,
    auth: authService,
    uploads: uploadRepository,
    storage: objectStorage,
    audit: auditService,
    enabled: config.CHARACTER_RIG_ENABLED,
    ...(dependencies.now ? { now: dependencies.now } : {}),
    repositories: {
      ...(dependencies.characterRigs ? { rigs: dependencies.characterRigs } : {}),
      ...(dependencies.characterJobs ? { jobs: dependencies.characterJobs } : {}),
    },
  });
  await registerActivityRoutes(
    app,
    new ActivityService(
      projects,
      processingJobRepository,
      exportRepository,
    ),
    authService,
  );
  await registerUploadRoutes(app, projects, uploadRuntime.service, authService, {
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
