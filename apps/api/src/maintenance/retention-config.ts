import { z } from "zod";

const retentionEnvironmentSchema = z.object({
  RETENTION_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  JOB_RETENTION_DAYS: z.coerce.number().int().min(7).max(3_650).default(90),
  AUDIT_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(90)
    .max(3_650)
    .default(400),
  USAGE_LEDGER_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(90)
    .max(3_650)
    .default(400),
  WORKER_HEARTBEAT_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(1)
    .max(90)
    .default(7),
  WORKER_EVENT_RETENTION_DAYS: z.coerce
    .number()
    .int()
    .min(7)
    .max(365)
    .default(30),
});

export type RetentionConfig = z.infer<typeof retentionEnvironmentSchema>;

export function loadRetentionConfig(
  environment: NodeJS.ProcessEnv = process.env,
): RetentionConfig {
  return retentionEnvironmentSchema.parse(environment);
}
