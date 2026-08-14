import type { FastifyInstance } from "fastify";
import { ApplicationDrainingError } from "../observability/operational-readiness.js";

export function registerHealthRoutes(
  app: FastifyInstance,
  options: {
    applicationVersion: string;
    release: string;
    readiness: (() => Promise<void>) | undefined;
  },
): void {
  const healthPayload = () => ({
    data: {
      status: "ok",
      service: "motionprep-api",
      version: options.applicationVersion,
      release: options.release,
      timestamp: new Date().toISOString(),
    },
    error: null,
  });
  const healthRouteOptions = { config: { rateLimit: false } } as const;
  const readinessRouteOptions = {
    config: {
      rateLimit: {
        max: 120,
        timeWindow: "1 minute",
        groupId: "health-ready",
        // Readiness must still diagnose Redis itself if the shared store fails.
        skipOnError: true,
      },
    },
  } as const;

  app.get("/v1/health", healthRouteOptions, async () => healthPayload());
  app.get("/v1/health/live", healthRouteOptions, async () => healthPayload());
  app.get("/v1/health/ready", readinessRouteOptions, async (request, reply) => {
    try {
      await options.readiness?.();
      return healthPayload();
    } catch (error) {
      const draining = error instanceof ApplicationDrainingError;
      return reply.status(503).send({
        data: {
          status: "degraded",
          service: "motionprep-api",
          version: options.applicationVersion,
          release: options.release,
          timestamp: new Date().toISOString(),
        },
        error: {
          code: draining ? "APPLICATION_DRAINING" : "DEPENDENCY_UNAVAILABLE",
          message: draining
            ? "الخادم يستكمل الطلبات الجارية ولا يقبل عملاً جديدًا."
            : "إحدى خدمات التخزين المطلوبة غير جاهزة.",
          requestId: request.id,
        },
      });
    }
  });
}
