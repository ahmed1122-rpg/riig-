import type { FastifyInstance } from "fastify";
import { requireUser } from "./authorize.js";
import { SESSION_COOKIE_NAME, type AuthService } from "./auth-service.js";
import {
  authError,
  mfaChallengeSchema,
  mfaConfirmSchema,
  mfaDisableSchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  recordAuthAudit,
  type SessionCookieOptions,
  setSessionCookie,
  validationError,
} from "./auth-route-support.js";

export async function registerAuthSecurityRoutes(
  app: FastifyInstance,
  auth: AuthService,
  options: SessionCookieOptions,
): Promise<void> {
  app.post("/v1/auth/mfa/challenge", {
    config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = mfaChallengeSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const result = await auth.completeMfaLogin(body.data);
      await recordAuthAudit(app, options, request, {
        actorUserId: result.session.user.id,
        action: "auth.mfa.login_completed",
        targetType: "user",
        targetId: result.session.user.id,
        outcome: "success",
        reason: null,
      });
      setSessionCookie(reply, result.token, options);
      return { data: result.session, error: null };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/mfa/setup", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    try {
      const user = await requireUser(request, auth);
      return { data: await auth.beginMfaSetup(user.id), error: null };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/mfa/setup/confirm", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = mfaConfirmSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const user = await requireUser(request, auth);
      const result = await auth.confirmMfaSetup({
        userId: user.id,
        ...body.data,
      });
      await recordAuthAudit(app, options, request, {
        actorUserId: user.id,
        action: "auth.mfa.enabled",
        targetType: "user",
        targetId: user.id,
        outcome: "success",
        reason: null,
      });
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return {
        data: { ...result, reauthenticationRequired: true },
        error: null,
      };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/mfa/disable", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = mfaDisableSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const user = await requireUser(request, auth);
      await auth.disableMfa({ userId: user.id, ...body.data });
      await recordAuthAudit(app, options, request, {
        actorUserId: user.id,
        action: "auth.mfa.disabled",
        targetType: "user",
        targetId: user.id,
        outcome: "success",
        reason: null,
      });
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return {
        data: { disabled: true, reauthenticationRequired: true },
        error: null,
      };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/password-reset/request", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = passwordResetRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    await auth.requestPasswordReset(body.data.email);
    return reply.status(202).send({
      data: {
        accepted: true,
        message: "إذا كان البريد مرتبطًا بحساب نشط فستصل رسالة إعادة التعيين.",
      },
      error: null,
    });
  });

  app.post("/v1/auth/password-reset/confirm", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = passwordResetConfirmSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const userId = await auth.resetPassword(body.data);
      await recordAuthAudit(app, options, request, {
        actorUserId: userId,
        action: "auth.password.reset",
        targetType: "user",
        targetId: userId,
        outcome: "success",
        reason: null,
      });
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return {
        data: { passwordReset: true, reauthenticationRequired: true },
        error: null,
      };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/password/change", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = passwordChangeSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const user = await requireUser(request, auth);
      await auth.changePassword({ userId: user.id, ...body.data });
      await recordAuthAudit(app, options, request, {
        actorUserId: user.id,
        action: "auth.password.changed",
        targetType: "user",
        targetId: user.id,
        outcome: "success",
        reason: null,
      });
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return {
        data: { passwordChanged: true, reauthenticationRequired: true },
        error: null,
      };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.get("/v1/auth/session", async (request, reply) => {
    try {
      return {
        data: await auth.session(request.cookies[SESSION_COOKIE_NAME]),
        error: null,
      };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    await auth.logout(request.cookies[SESSION_COOKIE_NAME]);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return { data: { loggedOut: true }, error: null };
  });
}
