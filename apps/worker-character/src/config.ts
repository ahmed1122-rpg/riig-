import { createWorkerEnvironmentSchema } from "@motionprep/api/object-storage-environment";
import { z } from "zod";

const configSchema = createWorkerEnvironmentSchema({
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
});

export function loadCharacterWorkerConfig(environment: NodeJS.ProcessEnv) {
  return configSchema.parse(environment);
}
