import type { FastifyInstance } from "fastify";
import { sendApiError } from "../http/api-response.js";
import {
  AuthDomainError,
  type AuthService,
} from "./auth-service.js";
import {
  adminBootstrapSchema,
  authError,
  emailVerificationSchema,
  loginSchema,
  passwordResetRequestSchema,
  recordAuthAudit,
  registerSchema,
  type SessionCookieOptions,
  setSessionCookie,
  validationError,
} from "./auth-route-support.js";
import { registerAuthSecurityRoutes } from "./auth-security-routes.js";

export async function registerAuthRoutes(
  app: FastifyInstance,
  auth: AuthService,
  options: SessionCookieOptions,
): Promise<void> {
  app.post("/v1/auth/register", {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = registerSchema.safeParse(request.body);
    if (!body.success) {
      return sendApiError(
        reply,
        request.id,
        400,
        "VALIDATION_FAILED",
        "تحقق من الاسم والبريد ومتطلبات كلمة المرور.",
      );
    }
    try {
      const result = await auth.registerWithPolicy(body.data);
      if (result.kind === "verification_required") {
        return reply.status(201).send({
          data: {
            verificationRequired: true,
            email: result.email,
            expiresAt: result.expiresAt,
          },
          error: null,
        });
      }
      setSessionCookie(reply, result.token, options);
      return reply.status(201).send({ data: result.session, error: null });
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/email/verify", {
    config: { rateLimit: { max: 20, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = emailVerificationSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const result = await auth.verifyEmail(body.data.token);
      await recordAuthAudit(app, options, request, {
        actorUserId: result.session.user.id,
        action: "auth.email.verified",
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

  app.post("/v1/auth/email/resend", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = passwordResetRequestSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    await auth.requestEmailVerification(body.data.email);
    return reply.status(202).send({
      data: { accepted: true },
      error: null,
    });
  });

  app.post("/v1/auth/admin-bootstrap", {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: "15 minutes",
        keyGenerator: () => "admin-bootstrap-global",
      },
    },
  }, async (request, reply) => {
    const body = adminBootstrapSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const result = await auth.bootstrapAdmin(body.data);
      await recordAuthAudit(app, options, request, {
        actorUserId: result.session.user.id,
        action: "auth.admin.bootstrap_completed",
        targetType: "user",
        targetId: result.session.user.id,
        outcome: "success",
        reason: null,
      });
      setSessionCookie(reply, result.token, options);
      return reply.status(201).send({ data: result.session, error: null });
    } catch (error) {
      await recordAuthAudit(app, options, request, {
        actorUserId: "anonymous",
        action: "auth.admin.bootstrap_denied",
        targetType: "system",
        targetId: "initial-admin",
        outcome: "denied",
        reason: error instanceof AuthDomainError ? error.code : "UNKNOWN",
      });
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/login", {
    config: { rateLimit: { max: 30, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) {
      return sendApiError(
        reply,
        request.id,
        400,
        "VALIDATION_FAILED",
        "بيانات الدخول غير صالحة.",
      );
    }
    try {
      const result = await auth.login({
        ...body.data,
        attemptKey: `${request.ip}:${body.data.email.toLowerCase()}`,
      });
      if (result.kind === "mfa_required") {
        return reply.status(202).send({
          data: {
            mfaRequired: true,
            challengeToken: result.challengeToken,
            expiresAt: result.expiresAt,
          },
          error: null,
        });
      }
      setSessionCookie(reply, result.token, options);
      await recordAuthAudit(app, options, request, {
        actorUserId: result.session.user.id,
        action: "auth.login.completed",
        targetType: "user",
        targetId: result.session.user.id,
        outcome: "success",
        reason: null,
      });
      return { data: result.session, error: null };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  await registerAuthSecurityRoutes(app, auth, options);
}
