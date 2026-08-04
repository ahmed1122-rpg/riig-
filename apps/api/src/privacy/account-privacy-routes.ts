import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/authorize.js";
import {
  AuthDomainError,
  SESSION_COOKIE_NAME,
  type AuthService,
} from "../auth/auth-service.js";
import { sendApiError } from "../http/api-response.js";
import { AccountPrivacyError, type AccountPrivacyService } from "./account-privacy.js";

const deletionSchema = z.object({
  password: z.string().min(1).max(128),
  confirmation: z.literal("DELETE"),
});

export async function registerAccountPrivacyRoutes(
  app: FastifyInstance,
  auth: AuthService,
  privacy: AccountPrivacyService,
): Promise<void> {
  app.get("/v1/account/export", async (request, reply) => {
    try {
      const user = await requireUser(request, auth);
      return { data: await privacy.exportAccount(user.id), error: null };
    } catch (error) {
      if (error instanceof AuthDomainError) {
        return sendApiError(reply, request.id, 401, error.code, error.message);
      }
      throw error;
    }
  });

  app.delete("/v1/account", {
    config: { rateLimit: { max: 3, timeWindow: "1 hour" } },
  }, async (request, reply) => {
    const body = deletionSchema.safeParse(request.body);
    if (!body.success) {
      return sendApiError(
        reply,
        request.id,
        400,
        "VALIDATION_FAILED",
        "أدخل كلمة المرور واكتب DELETE لتأكيد حذف الحساب.",
      );
    }
    try {
      const user = await requireUser(request, auth);
      const result = await privacy.requestDeletion({
        userId: user.id,
        password: body.data.password,
      });
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return reply.status(202).send({ data: result, error: null });
    } catch (error) {
      if (error instanceof AccountPrivacyError) {
        return sendApiError(reply, request.id, 409, error.code, error.message);
      }
      if (error instanceof AuthDomainError) {
        return sendApiError(reply, request.id, 400, error.code, error.message);
      }
      throw error;
    }
  });
}
