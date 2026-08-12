import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPostgresPersistence } from "./infrastructure/postgres/persistence.js";
import { createRedisSecurity } from "./infrastructure/redis/redis-login-attempt-store.js";
import { S3ObjectStorage } from "./storage/s3-object-storage.js";
import { createS3ObjectStorageOptions } from "./storage/object-storage-environment.js";
import { AesGcmSecretProtector, decodeAuthEncryptionKey } from "./auth/secret-protector.js";
import { SmtpEmailSender } from "./infrastructure/email/smtp-email-sender.js";
import { StripePaymentProvider } from "./billing/stripe-payment-provider.js";
import { LocalArabicPdfOcrEngine } from "@motionprep/document-processing";
import { EmailOutboxDispatcher } from "./infrastructure/email/email-outbox-dispatcher.js";
import { initializeTracing } from "./observability/tracing.js";
import { assertLiveWorker } from "./observability/worker-readiness.js";

const config = loadConfig();
const tracing = initializeTracing("motionprep-api", process.env);
const persistence =
  config.PERSISTENCE_MODE === "postgres"
    ? createPostgresPersistence(config)
    : null;
const security = config.REDIS_URL
  ? createRedisSecurity(config.REDIS_URL, {
      maxFailures: config.LOGIN_MAX_FAILURES,
      windowSeconds: config.LOGIN_ATTEMPT_WINDOW_SECONDS,
      lockSeconds: config.LOGIN_LOCK_SECONDS,
      onError: (error) => {
        const errorCode =
          "code" in error && typeof error.code === "string"
            ? error.code
            : "REDIS_CLIENT_ERROR";
        process.stderr.write(
          `${JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            service: "motionprep-api",
            message: "redis.client_error",
            context: { error_code: errorCode, error_name: error.name },
          })}\n`,
        );
      },
    })
  : null;
const objectStorage =
  config.OBJECT_STORAGE_MODE === "s3"
    ? new S3ObjectStorage(createS3ObjectStorageOptions(config))
    : null;
const secretProtector = config.AUTH_ENCRYPTION_KEY
  ? new AesGcmSecretProtector(
      decodeAuthEncryptionKey(config.AUTH_ENCRYPTION_KEY),
    )
  : null;
const emailSender =
  config.EMAIL_DELIVERY_MODE === "smtp"
    ? new SmtpEmailSender({
        host: config.SMTP_HOST!,
        port: config.SMTP_PORT,
        secure: config.SMTP_SECURE,
        requireTls: config.SMTP_REQUIRE_TLS,
        user: config.SMTP_USER!,
        password: config.SMTP_PASSWORD!,
        from: config.SMTP_FROM!,
      })
    : null;
const paymentProviders =
  config.PAYMENT_MODE === "live"
    ? [
        new StripePaymentProvider({
          secretKey: config.STRIPE_SECRET_KEY!,
          webhookSecret: config.STRIPE_WEBHOOK_SECRET!,
        }),
      ]
    : undefined;
const pdfOcrEngine =
  config.PROCESSING_EXECUTION_MODE === "inline" &&
  config.PDF_OCR_MODE === "local"
    ? new LocalArabicPdfOcrEngine({
        onProgress: (event) => {
          if (event.progress === 1) {
            process.stdout.write(
              `${JSON.stringify({
                timestamp: new Date().toISOString(),
                level: "info",
                service: "motionprep-api",
                message: "ocr.stage_completed",
                context: event,
              })}\n`,
            );
          }
        },
        onFallback: (event) => {
          process.stdout.write(
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "info",
              service: "motionprep-api",
              message: "ocr.fallback_selected",
              context: event,
            })}\n`,
          );
        },
        onReviewRequired: (review) => {
          process.stdout.write(
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "warning",
              service: "motionprep-api",
              message: "ocr.review_required",
              context: review,
            })}\n`,
          );
        },
      })
    : null;
const dependencyReadiness: Record<string, () => Promise<void>> = {
  ...(persistence ? { database: () => persistence.ready() } : {}),
  ...(security ? { redis: () => security.ready() } : {}),
  ...(objectStorage
    ? {
        object_storage: () =>
          objectStorage.ready(config.NODE_ENV !== "production"),
      }
    : {}),
  ...(emailSender ? { smtp: () => emailSender.ready() } : {}),
  ...(config.CHARACTER_RIG_ENABLED && persistence
    ? {
        character_worker: () =>
          assertLiveWorker(persistence.operationalStatus, "character"),
      }
    : {}),
};
const ready = () =>
  Promise.all(Object.values(dependencyReadiness).map((check) => check())).then(
    () => undefined,
  );
await ready();
const emailOutboxDispatcher =
  persistence && emailSender
    ? new EmailOutboxDispatcher(
        persistence.emailOutbox,
        emailSender,
        (event) => {
          process.stdout.write(
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              level: ["failed", "lease_lost"].includes(event.outcome)
                ? "error"
                : "info",
              service: "motionprep-api",
              message: `email.outbox_${event.outcome}`,
              context: event,
            })}\n`,
          );
        },
        () => new Date(),
        1_000,
        (error) => {
          process.stderr.write(
            `${JSON.stringify({
              timestamp: new Date().toISOString(),
              level: "error",
              service: "motionprep-api",
              message: "email.outbox_cycle_failed",
              context: {
                error: error instanceof Error ? error.message : String(error),
              },
            })}\n`,
          );
        },
      )
    : null;
emailOutboxDispatcher?.start();
const app = await buildApp(config, {
  ...persistence?.repositories,
  ...(persistence ? { adminAccess: persistence.adminAccess } : {}),
  ...(persistence ? { usageMeter: persistence.usageMeter } : {}),
  ...(persistence
    ? { operationalStatus: persistence.operationalStatus }
    : {}),
  ...(security ? { loginAttempts: security.loginAttempts } : {}),
  ...(security ? { rateLimitStore: security.rateLimitStore } : {}),
  ...(objectStorage ? { objectStorage } : {}),
  ...(secretProtector ? { secretProtector } : {}),
  ...(emailSender ? { emailSender } : {}),
  ...(paymentProviders ? { paymentProviders } : {}),
  ...(pdfOcrEngine ? { pdfOcrEngine } : {}),
  readiness: ready,
  dependencyReadiness,
});
app.addHook("onClose", async () => tracing.shutdown());
if (persistence || security || objectStorage || emailSender || pdfOcrEngine) {
  // Fastify's onClose lifecycle hook is invoked only during application
  // shutdown and cannot receive an HTTP request. CodeQL otherwise models this
  // generic hook registration as an unthrottled request handler.
  app.addHook("onClose", async () => {
    await Promise.all([
      persistence?.close(),
      security?.close(),
      pdfOcrEngine?.close(),
      emailOutboxDispatcher?.stop(),
    ]);
    objectStorage?.destroy();
    emailSender?.close();
  });
}

let shutdownStarted = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  app.log.info({ signal }, "server.shutdown_started");
  const forcedExit = setTimeout(() => {
    app.log.error({ signal }, "server.shutdown_timeout");
    process.exit(1);
  }, 15_000);
  forcedExit.unref();
  try {
    await app.close();
    clearTimeout(forcedExit);
    app.log.info({ signal }, "server.shutdown_completed");
  } catch (error) {
    clearTimeout(forcedExit);
    app.log.error(error, "server.shutdown_failed");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port: config.API_PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
