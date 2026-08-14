import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  isStrongPassword,
  PASSWORD_MAX_LENGTH,
} from "@motionprep/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireUser } from "./authorize.js";
import {
  AuthDomainError,
  SESSION_COOKIE_NAME,
  type AuthService,
} from "./auth-service.js";
import { sendApiError } from "../http/api-response.js";
import type { AuditService } from "../audit/audit-service.js";

interface SessionCookieOptions {
  secureCookies: boolean;
  sessionTtlSeconds: number;
  audit?: AuditService;
}

const strongPasswordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH)
  .refine(isStrongPassword);

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: strongPasswordSchema,
  legal: z.object({
    accepted: z.literal(true),
    termsVersion: z.literal(CURRENT_TERMS_VERSION),
    privacyVersion: z.literal(CURRENT_PRIVACY_VERSION),
  }),
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

const emailVerificationSchema = z.object({
  token: z.string().min(32).max(256),
});

const adminBootstrapSchema = registerSchema.extend({
  token: z.string().min(32).max(256),
});

const mfaChallengeSchema = z.object({
  challengeToken: z.string().min(32).max(256),
  code: z.string().trim().min(6).max(32),
});

const mfaConfirmSchema = z.object({
  setupToken: z.string().min(32).max(256),
  code: z.string().regex(/^\d{6}$/),
});

const mfaDisableSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().min(6).max(32),
});

const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(254),
});

const passwordResetConfirmSchema = z.object({
  token: z.string().min(32).max(256),
  newPassword: strongPasswordSchema,
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: strongPasswordSchema,
});

function authError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!(error instanceof AuthDomainError)) throw error;
  const status =
    error.code === "EMAIL_ALREADY_EXISTS"
      ? 409
      : error.code === "MFA_ALREADY_ENABLED"
        ? 409
      : error.code === "SESSION_INVALID"
        ? 401
      : error.code === "MFA_CHALLENGE_INVALID"
          ? 401
        : error.code === "ADMIN_BOOTSTRAP_DENIED"
          ? 403
        : error.code === "ACCOUNT_LOCKED"
          ? 429
          : 400;
  return sendApiError(reply, request.id, status, error.code, error.message);
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  options: SessionCookieOptions,
) {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: options.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: options.sessionTtlSeconds,
  });
}

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
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
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
        data: {
          ...result,
          reauthenticationRequired: true,
        },
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
      return { data: { disabled: true, reauthenticationRequired: true }, error: null };
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
        message:
          "إذا كان البريد مرتبطًا بحساب نشط فستصل رسالة إعادة التعيين.",
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

async function recordAuthAudit(
  app: FastifyInstance,
  options: SessionCookieOptions,
  request: FastifyRequest,
  event: {
    actorUserId: string;
    action: string;
    targetType: string;
    targetId: string;
    outcome: "success" | "denied" | "failed";
    reason: string | null;
  },
): Promise<void> {
  if (!options.audit) return;
  try {
    await options.audit.record({ ...event, requestId: request.id });
  } catch (error) {
    app.log.error(
      { err: error, audit_action: event.action },
      "auth.audit_record_failed",
    );
  }
}

function validationError(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  return sendApiError(
    reply,
    request.id,
    400,
    "VALIDATION_FAILED",
    "بيانات الأمان غير صالحة.",
  );
}
