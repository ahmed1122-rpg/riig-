import {
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

interface SessionCookieOptions {
  secureCookies: boolean;
  sessionTtlSeconds: number;
}

const strongPasswordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH)
  .refine(isStrongPassword);

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: strongPasswordSchema,
});

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
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
      const result = await auth.register(body.data);
      setSessionCookie(reply, result.token, options);
      return reply.status(201).send({ data: result.session, error: null });
    } catch (error) {
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
      setSessionCookie(reply, result.token, options);
      return { data: result.session, error: null };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/mfa/setup", async (request, reply) => {
    try {
      const user = await requireUser(request, auth);
      return { data: await auth.beginMfaSetup(user.id), error: null };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/mfa/setup/confirm", async (request, reply) => {
    const body = mfaConfirmSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const user = await requireUser(request, auth);
      const result = await auth.confirmMfaSetup({
          userId: user.id,
          ...body.data,
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

  app.post("/v1/auth/mfa/disable", async (request, reply) => {
    const body = mfaDisableSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const user = await requireUser(request, auth);
      await auth.disableMfa({ userId: user.id, ...body.data });
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
      await auth.resetPassword(body.data);
      reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
      return {
        data: { passwordReset: true, reauthenticationRequired: true },
        error: null,
      };
    } catch (error) {
      return authError(error, request, reply);
    }
  });

  app.post("/v1/auth/password/change", async (request, reply) => {
    const body = passwordChangeSchema.safeParse(request.body);
    if (!body.success) return validationError(request, reply);
    try {
      const user = await requireUser(request, auth);
      await auth.changePassword({ userId: user.id, ...body.data });
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
