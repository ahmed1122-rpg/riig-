import { z } from "zod";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
} from "@motionprep/contracts";
import {
  applicationObjectStorageFields,
  blankToUndefined,
  optionalText,
  optionalUrl,
  validateObjectStorageEnvironment,
} from "./storage/object-storage-environment.js";
import {
  decodeAuthEncryptionKeyring,
  isValidAuthEncryptionKey,
  isValidAuthEncryptionKeyring,
} from "./auth/secret-protector.js";
import { databaseUrlRequiresTls } from "./config/database-url-policy.js";

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    RELEASE_VERSION: z.string().trim().min(1).max(128).default("development"),
    API_PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
    API_DEREGISTRATION_DELAY_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(30_000)
      .default(0),
    API_SHUTDOWN_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(30_000)
      .max(180_000)
      .default(130_000),
    WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
    E2E_ADMIN_EMAIL: z.preprocess(
      blankToUndefined,
      z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
    ),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_UPLOAD_BYTES)
      .default(MAX_UPLOAD_BYTES),
    MAX_IMAGE_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(MAX_IMAGE_UPLOAD_BYTES)
      .default(MAX_IMAGE_UPLOAD_BYTES),
    UPLOAD_BODY_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(3),
    SESSION_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(900)
      .max(30 * 24 * 60 * 60)
      .default(8 * 60 * 60),
    COOKIE_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    PAYMENT_MODE: z.enum(["disabled", "sandbox", "live"]).default("sandbox"),
    USAGE_METERING_MODE: z
      .enum(["off", "shadow", "soft", "hard-jobs", "hard"])
      .default("shadow"),
    STRIPE_SECRET_KEY: optionalText(16),
    STRIPE_WEBHOOK_SECRET: optionalText(16),
    PERSISTENCE_MODE: z.enum(["memory", "postgres"]).default("memory"),
    DATABASE_URL: optionalUrl,
    DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),
    REDIS_URL: optionalUrl,
    METRICS_BEARER_TOKEN: optionalText(32),
    OBJECT_STORAGE_MODE: z.enum(["memory", "s3"]).default("memory"),
    MALWARE_SCAN_MODE: z.enum(["disabled", "required"]).default("disabled"),
    ...applicationObjectStorageFields,
    PROCESSING_EXECUTION_MODE: z
      .enum(["inline", "worker"])
      .default("inline"),
    RASTER_ASSET_WRITE_CONCURRENCY: z.coerce
      .number()
      .int()
      .min(1)
      .max(4)
      .default(2),
    EXPORT_EXECUTION_MODE: z
      .enum(["inline", "worker"])
      .default("inline"),
    PDF_OCR_MODE: z.enum(["disabled", "local"]).default("disabled"),
    PDF_REGION_OCR_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    CHARACTER_RIG_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    LOGIN_MAX_FAILURES: z.coerce.number().int().min(3).max(20).default(5),
    LOGIN_ATTEMPT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(24 * 60 * 60)
      .default(15 * 60),
    LOGIN_LOCK_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(24 * 60 * 60)
      .default(5 * 60),
    AUTH_ENCRYPTION_KEY: z.preprocess(
      blankToUndefined,
      z
        .string()
        .refine(
          isValidAuthEncryptionKey,
          "AUTH_ENCRYPTION_KEY must be canonical Base64 for exactly 32 bytes.",
        )
        .optional(),
    ),
    AUTH_ENCRYPTION_KEYRING: z.preprocess(
      blankToUndefined,
      z.string().refine(
        isValidAuthEncryptionKeyring,
        "AUTH_ENCRYPTION_KEYRING must contain one to five key-id:canonical-base64 entries.",
      ).optional(),
    ),
    AUTH_ENCRYPTION_ACTIVE_KEY_ID: z.preprocess(
      blankToUndefined,
      z.string().regex(/^[A-Za-z0-9_-]{1,32}$/u).optional(),
    ),
    TOTP_ISSUER: z.string().trim().min(2).max(50).default("MotionPrep"),
    PASSWORD_RESET_URL: optionalUrl,
    EMAIL_VERIFICATION_REQUIRED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    EMAIL_VERIFICATION_URL: optionalUrl,
    ADMIN_BOOTSTRAP_EMAIL: z.preprocess(
      blankToUndefined,
      z.string().trim().email().transform((value) => value.toLowerCase()).optional(),
    ),
    ADMIN_BOOTSTRAP_TOKEN_HASH: z.preprocess(
      blankToUndefined,
      z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    ),
    EMAIL_DELIVERY_MODE: z.enum(["memory", "smtp"]).default("memory"),
    SMTP_HOST: z.preprocess(
      blankToUndefined,
      z.string().trim().min(1).optional(),
    ),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_SECURE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SMTP_REQUIRE_TLS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SMTP_USER: optionalText(),
    SMTP_PASSWORD: optionalText(),
    SMTP_FROM: z.preprocess(
      blankToUndefined,
      z.string().email().optional(),
    ),
  })
  .superRefine((value, context) => {
    if (
      value.NODE_ENV === "production" &&
      value.API_DEREGISTRATION_DELAY_MS < 10_000
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["API_DEREGISTRATION_DELAY_MS"],
        message:
          "Production requires at least 10000ms for readiness deregistration.",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      value.API_SHUTDOWN_TIMEOUT_MS <
        value.API_DEREGISTRATION_DELAY_MS + 120_000
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["API_SHUTDOWN_TIMEOUT_MS"],
        message:
          "Production shutdown must cover deregistration plus the 120s proxy request deadline.",
      });
    }
    if (value.E2E_ADMIN_EMAIL && value.NODE_ENV !== "test") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["E2E_ADMIN_EMAIL"],
        message: "E2E_ADMIN_EMAIL is allowed only when NODE_ENV=test.",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      !/^[a-f0-9]{40}$/u.test(value.RELEASE_VERSION)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["RELEASE_VERSION"],
        message:
          "Production RELEASE_VERSION must be the 40-character release Git SHA.",
      });
    }
    if (value.PERSISTENCE_MODE === "postgres" && !value.DATABASE_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message: "DATABASE_URL is required when PERSISTENCE_MODE=postgres.",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      value.PERSISTENCE_MODE !== "postgres"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PERSISTENCE_MODE"],
        message: "Production must use PostgreSQL persistence.",
      });
    }
    if (value.NODE_ENV === "production" && value.PAYMENT_MODE === "sandbox") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PAYMENT_MODE"],
        message: "Production payments must be disabled or use live mode.",
      });
    }
    if (
      value.PAYMENT_MODE === "live" &&
      (!value.STRIPE_SECRET_KEY || !value.STRIPE_WEBHOOK_SECRET)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STRIPE_SECRET_KEY"],
        message: "Stripe secret and webhook secret are required in live mode.",
      });
    }
    if (value.NODE_ENV === "production" && !value.COOKIE_SECURE) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["COOKIE_SECURE"],
        message: "Production cookies must be Secure.",
      });
    }
    if (value.NODE_ENV === "production" && !value.REDIS_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message: "Production requires Redis for distributed login throttling.",
      });
    }
    if (value.NODE_ENV === "production" && !value.METRICS_BEARER_TOKEN) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["METRICS_BEARER_TOKEN"],
        message: "Production internal metrics require a bearer token.",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      value.DATABASE_URL &&
      !databaseUrlRequiresTls(value.DATABASE_URL)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DATABASE_URL"],
        message:
          "Production DATABASE_URL must require TLS with sslmode=require, verify-ca, or verify-full.",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      value.REDIS_URL &&
      new URL(value.REDIS_URL).protocol !== "rediss:"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["REDIS_URL"],
        message: "Production REDIS_URL must use rediss://.",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      new URL(value.WEB_ORIGIN).protocol !== "https:"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WEB_ORIGIN"],
        message: "Production WEB_ORIGIN must use HTTPS.",
      });
    }
    if (
      value.PERSISTENCE_MODE === "postgres" &&
      !value.AUTH_ENCRYPTION_KEY &&
      !value.AUTH_ENCRYPTION_KEYRING
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_ENCRYPTION_KEY"],
        message:
          "Persistent authentication requires a stable encryption key or keyring.",
      });
    }
    if (Boolean(value.AUTH_ENCRYPTION_KEYRING) !== Boolean(value.AUTH_ENCRYPTION_ACTIVE_KEY_ID)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_ENCRYPTION_ACTIVE_KEY_ID"],
        message: "AUTH_ENCRYPTION_KEYRING and AUTH_ENCRYPTION_ACTIVE_KEY_ID are required together.",
      });
    }
    if (
      value.AUTH_ENCRYPTION_KEYRING &&
      value.AUTH_ENCRYPTION_ACTIVE_KEY_ID &&
      isValidAuthEncryptionKeyring(value.AUTH_ENCRYPTION_KEYRING) &&
      !decodeAuthEncryptionKeyring(value.AUTH_ENCRYPTION_KEYRING).has(
        value.AUTH_ENCRYPTION_ACTIVE_KEY_ID,
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_ENCRYPTION_ACTIVE_KEY_ID"],
        message: "AUTH_ENCRYPTION_ACTIVE_KEY_ID must identify a keyring entry.",
      });
    }
    if (value.NODE_ENV === "production" && !value.AUTH_ENCRYPTION_KEYRING) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AUTH_ENCRYPTION_KEYRING"],
        message: "Production authentication requires a rotatable encryption keyring.",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      value.EMAIL_DELIVERY_MODE !== "smtp"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_DELIVERY_MODE"],
        message: "Production password reset requires SMTP delivery.",
      });
    }
    if (value.NODE_ENV === "production" && !value.EMAIL_VERIFICATION_REQUIRED) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_VERIFICATION_REQUIRED"],
        message: "Production registration requires email verification.",
      });
    }
    if (value.EMAIL_VERIFICATION_REQUIRED && !value.EMAIL_VERIFICATION_URL) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EMAIL_VERIFICATION_URL"],
        message: "EMAIL_VERIFICATION_URL is required when verification is enabled.",
      });
    }
    if (
      Boolean(value.ADMIN_BOOTSTRAP_EMAIL) !==
      Boolean(value.ADMIN_BOOTSTRAP_TOKEN_HASH)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ADMIN_BOOTSTRAP_TOKEN_HASH"],
        message: "Admin bootstrap email and token hash are required together.",
      });
    }
    if (value.EMAIL_DELIVERY_MODE === "smtp") {
      for (const field of [
        "SMTP_HOST",
        "SMTP_USER",
        "SMTP_PASSWORD",
        "SMTP_FROM",
      ] as const) {
        if (!value[field]) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `${field} is required when EMAIL_DELIVERY_MODE=smtp.`,
          });
        }
      }
    }
    if (
      value.NODE_ENV === "production" &&
      !value.SMTP_SECURE &&
      !value.SMTP_REQUIRE_TLS
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["SMTP_REQUIRE_TLS"],
        message:
          "Production SMTP must use implicit TLS or require STARTTLS.",
      });
    }
    if (value.NODE_ENV === "production" && value.OBJECT_STORAGE_MODE !== "s3") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["OBJECT_STORAGE_MODE"],
        message: "Production must use durable S3-compatible object storage.",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      value.MALWARE_SCAN_MODE !== "required"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["MALWARE_SCAN_MODE"],
        message: "Production uploads require fail-closed malware scanning.",
      });
    }
    validateObjectStorageEnvironment(
      value,
      context,
      value.OBJECT_STORAGE_MODE === "s3",
    );
    if (
      value.NODE_ENV === "production" &&
      value.PROCESSING_EXECUTION_MODE !== "worker"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PROCESSING_EXECUTION_MODE"],
        message: "Production processing must run in a separate worker.",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      value.EXPORT_EXECUTION_MODE !== "worker"
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["EXPORT_EXECUTION_MODE"],
        message: "Production exports must run in a separate worker.",
      });
    }
    if (value.NODE_ENV === "production" && value.PDF_OCR_MODE !== "local") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["PDF_OCR_MODE"],
        message: "Production PDF processing must enable private local OCR.",
      });
    }
  });

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  return environmentSchema.parse(environment);
}
