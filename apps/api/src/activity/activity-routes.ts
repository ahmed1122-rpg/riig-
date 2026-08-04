import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/authorize.js";
import type { AuthService } from "../auth/auth-service.js";
import { trySendAuthDomainError } from "../auth/auth-route-error.js";
import { sendApiError } from "../http/api-response.js";
import {
  ActivityDomainError,
  type ActivityService,
} from "./activity-service.js";

const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(12),
  cursor: z.string().min(1).max(500).optional(),
});

export async function registerActivityRoutes(
  app: FastifyInstance,
  activity: ActivityService,
  auth: AuthService,
): Promise<void> {
  app.get(
    "/v1/activity",
    {
      config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
      schema: {
        tags: ["projects"],
        summary: "List the authenticated creator's workflow activity",
        querystring: {
          type: "object",
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 50, default: 12 },
            cursor: { type: "string", minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const query = activityQuerySchema.safeParse(request.query);
      if (!query.success) {
        return sendApiError(
          reply,
          request.id,
          400,
          "VALIDATION_FAILED",
          "إعدادات صفحة النشاط غير صالحة.",
        );
      }
      try {
        const user = await requireUser(request, auth);
        return {
          data: await activity.listOwnedByUser(user.id, {
            limit: query.data.limit,
            ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
          }),
          error: null,
        };
      } catch (error) {
        const authResponse = trySendAuthDomainError(error, request, reply);
        if (authResponse) return authResponse;
        if (error instanceof ActivityDomainError) {
          return sendApiError(
            reply,
            request.id,
            400,
            error.code,
            error.message,
          );
        }
        throw error;
      }
    },
  );
}
