import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPostgresPersistence } from "./infrastructure/postgres/persistence.js";
import { createRedisSecurity } from "./infrastructure/redis/redis-login-attempt-store.js";
import { S3ObjectStorage } from "./storage/s3-object-storage.js";
import { createS3ObjectStorageOptions } from "./storage/object-storage-environment.js";
import {
  AesGcmSecretProtector,
  KeyringSecretProtector,
  decodeAuthEncryptionKey,
  decodeAuthEncryptionKeyring,
} from "./auth/secret-protector.js";
import { SmtpEmailSender } from "./infrastructure/email/smtp-email-sender.js";
import { StripePaymentProvider } from "./billing/stripe-payment-provider.js";
import { LocalArabicPdfOcrEngine } from "@motionprep/document-processing";
import { EmailOutboxDispatcher } from "./infrastructure/email/email-outbox-dispatcher.js";
import { initializeTracing } from "./observability/tracing.js";
import { assertLiveWorker } from "./observability/worker-readiness.js";
import { OperationalReadiness } from "./observability/operational-readiness.js";
import { LeaseGuardedObjectStorage } from "./storage/leased-object-storage.js";

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
const rawObjectStorage =
  config.OBJECT_STORAGE_MODE === "s3"
    ? new S3ObjectStorage(createS3ObjectStorageOptions(config))
    : null;
const objectStorage =
  rawObjectStorage && persistence
    ? new LeaseGuardedObjectStorage(
        rawObjectStorage,
        persistence.objectWriteLeases,
      )
    : rawObjectStorage;
const secretProtector = config.AUTH_ENCRYPTION_KEYRING &&
  config.AUTH_ENCRYPTION_ACTIVE_KEY_ID
  ? new KeyringSecretProtector(
      config.AUTH_ENCRYPTION_ACTIVE_KEY_ID,
      decodeAuthEncryptionKeyring(config.AUTH_ENCRYPTION_KEYRING),
      config.AUTH_ENCRYPTION_KEY
        ? [decodeAuthEncryptionKey(config.AUTH_ENCRYPTION_KEY)]
        : [],
    )
  : config.AUTH_ENCRYPTION_KEY
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
  ...(rawObjectStorage
    ? {
        object_storage: () =>
          rawObjectStorage.ready(config.NODE_ENV !== "production"),
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
const operationalReadiness = new OperationalReadiness(dependencyReadiness);
const ready = () => operationalReadiness.assertReady();
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
    rawObjectStorage?.destroy();
    emailSender?.close();
  });
}

let shutdownStarted = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;
  operationalReadiness.beginDrain();
  app.log.info({ signal }, "server.shutdown_started");
  const forcedExit = setTimeout(() => {
    app.log.error({ signal }, "server.shutdown_timeout");
    process.exit(1);
  }, config.API_SHUTDOWN_TIMEOUT_MS);
  forcedExit.unref();
  try {
    if (config.API_DEREGISTRATION_DELAY_MS > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, config.API_DEREGISTRATION_DELAY_MS);
      });
    }
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
