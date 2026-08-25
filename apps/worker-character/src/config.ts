import { createWorkerEnvironmentSchema } from "@motionprep/api/object-storage-environment";
import { z } from "zod";

const configSchema = createWorkerEnvironmentSchema({
  CHARACTER_INFERENCE_URL: z.string().url(),
  CHARACTER_INFERENCE_API_KEY: z.string().min(16),
  CHARACTER_INFERENCE_PROTOCOL: z
    .enum(["direct-v1", "async-v1"])
    .default("direct-v1"),
  CHARACTER_INFERENCE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(15 * 60_000)
    .default(5 * 60_000),
  CHARACTER_INFERENCE_OPERATION_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(30 * 60_000)
    .default(15 * 60_000),
  CHARACTER_INFERENCE_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(30_000)
    .default(1_000),
  CHARACTER_INFERENCE_MAX_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .min(250)
    .max(60_000)
    .default(10_000),
  CHARACTER_INFERENCE_ALLOW_INSECURE_LOCALHOST: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CHARACTER_POLL_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(30_000)
    .default(1_000),
  CHARACTER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  CHARACTER_LEASE_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(30 * 60_000)
    .default(10 * 60_000),
  CHARACTER_DRAIN_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(5 * 60_000)
    .default(30_000),
  CHARACTER_WORKER_ID: z.string().trim().min(3).optional(),
}).superRefine((value, context) => {
  const url = new URL(value.CHARACTER_INFERENCE_URL);
  const isLocalhost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(value.CHARACTER_INFERENCE_ALLOW_INSECURE_LOCALHOST && isLocalhost)
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CHARACTER_INFERENCE_URL"],
      message:
        "Character inference requires HTTPS; insecure HTTP is allowed only for explicitly enabled localhost development.",
    });
  }
  if (
    value.CHARACTER_INFERENCE_OPERATION_TIMEOUT_MS <
    value.CHARACTER_INFERENCE_TIMEOUT_MS
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CHARACTER_INFERENCE_OPERATION_TIMEOUT_MS"],
      message:
        "Character inference operation timeout must be at least the per-request timeout.",
    });
  }
  if (
    value.CHARACTER_INFERENCE_MAX_POLL_INTERVAL_MS <
    value.CHARACTER_INFERENCE_POLL_INTERVAL_MS
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["CHARACTER_INFERENCE_MAX_POLL_INTERVAL_MS"],
      message:
        "Character inference maximum poll interval must be at least the initial poll interval.",
    });
  }
});

export function loadCharacterWorkerConfig(environment: NodeJS.ProcessEnv) {
  return configSchema.parse(environment);
}
