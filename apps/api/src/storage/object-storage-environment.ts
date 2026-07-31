import { z, type RefinementCtx } from "zod";
import type { S3ObjectStorageOptions } from "./s3-object-storage.js";

export const blankToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

export const optionalUrl = z.preprocess(
  blankToUndefined,
  z.string().url().optional(),
);

export const optionalText = (minimumLength = 1) =>
  z.preprocess(
    blankToUndefined,
    z.string().min(minimumLength).optional(),
  );

const bucketName = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/);

const commonObjectStorageFields = {
  OBJECT_STORAGE_ENDPOINT: optionalUrl,
  OBJECT_STORAGE_REGION: z.string().trim().min(1).default("us-east-1"),
  OBJECT_STORAGE_ACCESS_KEY: optionalText(),
  OBJECT_STORAGE_SECRET_KEY: optionalText(8),
  OBJECT_STORAGE_SESSION_TOKEN: optionalText(),
  OBJECT_STORAGE_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  OBJECT_STORAGE_ENCRYPTION_MODE: z
    .enum(["none", "bucket-default", "sse-s3"])
    .default("none"),
  OBJECT_STORAGE_REQUIRE_VERSIONING: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
} as const;

export const applicationObjectStorageFields = {
  ...commonObjectStorageFields,
  OBJECT_STORAGE_BUCKET: z.preprocess(
    blankToUndefined,
    bucketName.optional(),
  ),
} as const;

export const workerObjectStorageFields = {
  ...commonObjectStorageFields,
  OBJECT_STORAGE_BUCKET: bucketName,
} as const;

const workerEnvironmentFields = {
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(50).default(5),
  ...workerObjectStorageFields,
} as const;

interface ObjectStorageEnvironment {
  NODE_ENV: "development" | "test" | "production";
  OBJECT_STORAGE_ENDPOINT?: string | undefined;
  OBJECT_STORAGE_BUCKET?: string | undefined;
  OBJECT_STORAGE_ACCESS_KEY?: string | undefined;
  OBJECT_STORAGE_SECRET_KEY?: string | undefined;
  OBJECT_STORAGE_SESSION_TOKEN?: string | undefined;
  OBJECT_STORAGE_ENCRYPTION_MODE: "none" | "bucket-default" | "sse-s3";
  OBJECT_STORAGE_REQUIRE_VERSIONING: boolean;
}

interface S3ObjectStorageEnvironment extends ObjectStorageEnvironment {
  OBJECT_STORAGE_REGION: string;
  OBJECT_STORAGE_FORCE_PATH_STYLE: boolean;
}

export function validateObjectStorageEnvironment(
  value: ObjectStorageEnvironment,
  context: RefinementCtx,
  enabled = true,
): void {
  if (!enabled) return;
  if (!value.OBJECT_STORAGE_BUCKET) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OBJECT_STORAGE_BUCKET"],
      message: "OBJECT_STORAGE_BUCKET is required when object storage is enabled.",
    });
  }

  const hasAccessKey = Boolean(value.OBJECT_STORAGE_ACCESS_KEY);
  const hasSecretKey = Boolean(value.OBJECT_STORAGE_SECRET_KEY);
  if (hasAccessKey !== hasSecretKey) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OBJECT_STORAGE_ACCESS_KEY"],
      message:
        "OBJECT_STORAGE_ACCESS_KEY and OBJECT_STORAGE_SECRET_KEY must be provided together.",
    });
  }
  if (
    value.OBJECT_STORAGE_SESSION_TOKEN &&
    !(hasAccessKey && hasSecretKey)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OBJECT_STORAGE_SESSION_TOKEN"],
      message:
        "OBJECT_STORAGE_SESSION_TOKEN requires explicit access and secret keys.",
    });
  }
  if (value.OBJECT_STORAGE_ENDPOINT && !(hasAccessKey && hasSecretKey)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OBJECT_STORAGE_ACCESS_KEY"],
      message:
        "A custom S3-compatible endpoint requires explicit credentials.",
    });
  }
  if (
    value.NODE_ENV === "production" &&
    value.OBJECT_STORAGE_ENDPOINT &&
    new URL(value.OBJECT_STORAGE_ENDPOINT).protocol !== "https:"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OBJECT_STORAGE_ENDPOINT"],
      message: "Production object storage endpoints must use HTTPS.",
    });
  }
  if (
    value.NODE_ENV === "production" &&
    value.OBJECT_STORAGE_ENCRYPTION_MODE === "none"
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OBJECT_STORAGE_ENCRYPTION_MODE"],
      message:
        "Production workers require encrypted object storage (SSE-S3 or encrypted bucket default).",
    });
  }
  if (
    value.NODE_ENV === "production" &&
    !value.OBJECT_STORAGE_REQUIRE_VERSIONING
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["OBJECT_STORAGE_REQUIRE_VERSIONING"],
      message:
        "Production object storage must require bucket versioning for coordinated recovery.",
    });
  }
}

export function createWorkerEnvironmentSchema<Fields extends z.ZodRawShape>(
  fields: Fields,
) {
  return z
    .object({
      ...workerEnvironmentFields,
      ...fields,
    })
    .superRefine((value, context) => {
      validateObjectStorageEnvironment(
        value as ObjectStorageEnvironment,
        context,
      );
    });
}

export function createS3ObjectStorageOptions(
  environment: S3ObjectStorageEnvironment,
): S3ObjectStorageOptions {
  if (!environment.OBJECT_STORAGE_BUCKET) {
    throw new Error("OBJECT_STORAGE_BUCKET is required for S3 storage.");
  }
  return {
    ...(environment.OBJECT_STORAGE_ENDPOINT
      ? { endpoint: environment.OBJECT_STORAGE_ENDPOINT }
      : {}),
    region: environment.OBJECT_STORAGE_REGION,
    bucket: environment.OBJECT_STORAGE_BUCKET,
    ...(environment.OBJECT_STORAGE_ACCESS_KEY &&
    environment.OBJECT_STORAGE_SECRET_KEY
      ? {
          accessKeyId: environment.OBJECT_STORAGE_ACCESS_KEY,
          secretAccessKey: environment.OBJECT_STORAGE_SECRET_KEY,
          ...(environment.OBJECT_STORAGE_SESSION_TOKEN
            ? { sessionToken: environment.OBJECT_STORAGE_SESSION_TOKEN }
            : {}),
        }
      : {}),
    forcePathStyle: environment.OBJECT_STORAGE_FORCE_PATH_STYLE,
    encryptionMode: environment.OBJECT_STORAGE_ENCRYPTION_MODE,
    requireVersioning: environment.OBJECT_STORAGE_REQUIRE_VERSIONING,
  };
}
