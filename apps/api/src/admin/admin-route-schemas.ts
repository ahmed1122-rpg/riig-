import { z } from "zod";

export const updateUserSchema = z
  .object({
    role: z.enum(["creator", "support", "finance", "admin"]).optional(),
    status: z.enum(["active", "suspended", "pending_verification"]).optional(),
    reason: z.string().trim().min(10).max(500),
  })
  .refine((value) => value.role !== undefined || value.status !== undefined);

export const userParamsSchema = z.object({ userId: z.string().uuid() });
export const processingParamsSchema = z.object({ jobId: z.string().uuid() });
export const retryProcessingSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});
