import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../config.js";
import type { RateLimitStoreConstructor } from "../infrastructure/redis/redis-rate-limit-store.js";
import { isCookieMutationOriginAllowed } from "./cookie-mutation-origin.js";

export async function registerHttpSecurity(
  app: FastifyInstance,
  config: AppConfig,
  rateLimitStore?: RateLimitStoreConstructor,
): Promise<void> {
  await app.register(helmet, {
    hsts:
      config.NODE_ENV === "production"
        ? { maxAge: 31_536_000, includeSubDomains: true }
        : false,
  });
  const allowedWebOrigins = allowedOrigins(config);
  await app.register(cors, {
    origin: [...allowedWebOrigins],
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(cookie);
  app.addHook("onRequest", async (request, reply) => {
    if (
      !isCookieMutationOriginAllowed({
        method: request.method,
        hasSessionCookie: Boolean(request.cookies.motionprep_session),
        ...(request.headers.origin ? { origin: request.headers.origin } : {}),
        ...(request.headers.referer ? { referer: request.headers.referer } : {}),
        allowedOrigins: allowedWebOrigins,
        requireOrigin: config.NODE_ENV === "production",
      })
    ) {
      return reply.status(403).send({
        data: null,
        error: {
          code: "CROSS_ORIGIN_MUTATION_BLOCKED",
          message: "رُفض الطلب لأن مصدره لا يطابق واجهة التطبيق الموثوقة.",
          requestId: request.id,
        },
      });
    }
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: "1 minute",
    skipOnError: false,
    ...(rateLimitStore ? { store: rateLimitStore } : {}),
    nameSpace: "motionprep:rate-limit:",
  });
}

function allowedOrigins(config: AppConfig): Set<string> {
  const origins = new Set([new URL(config.WEB_ORIGIN).origin]);
  if (config.NODE_ENV === "production") return origins;
  const configured = new URL(config.WEB_ORIGIN);
  for (const hostname of ["localhost", "127.0.0.1"]) {
    configured.hostname = hostname;
    origins.add(configured.origin);
  }
  return origins;
}
