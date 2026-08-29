import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
  isStrongPassword,
  PASSWORD_MAX_LENGTH,
} from "@motionprep/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuditService } from "../audit/audit-service.js";
import { sendApiError } from "../http/api-response.js";
import {
  AuthDomainError,
  SESSION_COOKIE_NAME,
} from "./auth-service.js";

export interface SessionCookieOptions {
  secureCookies: boolean;
  sessionTtlSeconds: number;
  audit?: AuditService;
}

const strongPasswordSchema = z
  .string()
  .max(PASSWORD_MAX_LENGTH)
  .refine(isStrongPassword);

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().email().max(254),
  password: strongPasswordSchema,
  legal: z.object({
    accepted: z.literal(true),
    termsVersion: z.literal(CURRENT_TERMS_VERSION),
    privacyVersion: z.literal(CURRENT_PRIVACY_VERSION),
  }),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
});

export const emailVerificationSchema = z.object({
  token: z.string().min(32).max(256),
});

export const adminBootstrapSchema = registerSchema.extend({
  token: z.string().min(32).max(256),
});

export const mfaChallengeSchema = z.object({
  challengeToken: z.string().min(32).max(256),
  code: z.string().trim().min(6).max(32),
});

export const mfaConfirmSchema = z.object({
  setupToken: z.string().min(32).max(256),
  code: z.string().regex(/^\d{6}$/u),
});

export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().min(6).max(32),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().email().max(254),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(32).max(256),
  newPassword: strongPasswordSchema,
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: strongPasswordSchema,
});

const AUTH_ERROR_STATUS: Partial<Record<AuthDomainError["code"], number>> = {
  EMAIL_ALREADY_EXISTS: 409,
  MFA_ALREADY_ENABLED: 409,
  SESSION_INVALID: 401,
  AUTHORIZATION_DENIED: 403,
  MFA_CHALLENGE_INVALID: 401,
  ADMIN_BOOTSTRAP_DENIED: 403,
  ACCOUNT_LOCKED: 429,
};

export function authError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!(error instanceof AuthDomainError)) throw error;
  return sendApiError(
    reply,
    request.id,
    AUTH_ERROR_STATUS[error.code] ?? 400,
    error.code,
    error.message,
  );
}

export function setSessionCookie(
  reply: FastifyReply,
  token: string,
  options: SessionCookieOptions,
): void {
  reply.setCookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: options.secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: options.sessionTtlSeconds,
  });
}

export async function recordAuthAudit(
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

export function validationError(
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
