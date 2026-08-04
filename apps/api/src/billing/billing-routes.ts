import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthService } from "../auth/auth-service.js";
import { requireUser } from "../auth/authorize.js";
import { trySendAuthDomainError } from "../auth/auth-route-error.js";
import { sendApiError } from "../http/api-response.js";
import { requestIdempotencyKey } from "../http/request-metadata.js";
import { BillingDomainError, type BillingService } from "./billing-service.js";

const checkoutSchema = z.object({
  providerId: z.enum(["sandbox-card", "sandbox-local", "stripe"]),
  planId: z.enum(["creator", "studio"]),
  currency: z.enum(["USD", "EGP"]),
  returnUrl: z.string().url(),
});

const paramsSchema = z.object({ checkoutId: z.string().uuid() });
const portalSchema = z.object({ returnUrl: z.string().url() });
const webhookParamsSchema = z.object({
  providerId: z.enum(["stripe"]),
});

function routeError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const authError = trySendAuthDomainError(error, request, reply);
  if (authError) return authError;
  if (error instanceof BillingDomainError) {
    const status = billingErrorStatus(error.code);
    return sendApiError(reply, request.id, status, error.code, error.message);
  }
  throw error;
}

function billingErrorStatus(code: BillingDomainError["code"]): number {
  switch (code) {
    case "CHECKOUT_NOT_FOUND":
      return 404;
    case "CHECKOUT_NOT_COMPLETABLE":
    case "IDEMPOTENCY_CONFLICT":
    case "SUBSCRIPTION_NOT_MANAGEABLE":
      return 409;
    case "PAYMENT_PROVIDER_UNAVAILABLE":
      return 503;
    case "WEBHOOK_SIGNATURE_INVALID":
    case "WEBHOOK_EVENT_INVALID":
      return 400;
  }
}

export async function registerBillingRoutes(
  app: FastifyInstance,
  auth: AuthService,
  billing: BillingService,
  options: {
    allowedReturnOrigin: string;
    sandbox: boolean;
    mode: "disabled" | "sandbox" | "live";
  },
): Promise<void> {
  app.get("/v1/billing/config", async (request, reply) => {
    try {
      await requireUser(request, auth);
      return {
        data: {
          mode: options.mode,
          providers: billing.availableProviders(),
          plans: billing.planCatalog(),
        },
        error: null,
      };
    } catch (error) {
      return routeError(error, request, reply);
    }
  });

  app.get("/v1/billing/subscription", async (request, reply) => {
    try {
      const user = await requireUser(request, auth);
      return {
        data: await billing.subscription(user.id),
        error: null,
      };
    } catch (error) {
      return routeError(error, request, reply);
    }
  });

  app.get("/v1/billing/checkouts/:checkoutId", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      return sendApiError(
        reply,
        request.id,
        404,
        "CHECKOUT_NOT_FOUND",
        "جلسة الدفع غير موجودة.",
      );
    }
    try {
      const user = await requireUser(request, auth);
      return {
        data: await billing.checkout(params.data.checkoutId, user.id),
        error: null,
      };
    } catch (error) {
      return routeError(error, request, reply);
    }
  });

  app.post("/v1/billing/checkouts", async (request, reply) => {
    const body = checkoutSchema.safeParse(request.body);
    if (!body.success) {
      return sendApiError(
        reply,
        request.id,
        400,
        "VALIDATION_FAILED",
        "إعدادات الدفع غير صالحة.",
      );
    }
    if (new URL(body.data.returnUrl).origin !== options.allowedReturnOrigin) {
      return sendApiError(
        reply,
        request.id,
        400,
        "RETURN_URL_NOT_ALLOWED",
        "عنوان العودة غير مسموح.",
      );
    }
    try {
      const user = await requireUser(request, auth);
      const checkout = await billing.createCheckout({
        actor: user,
        ...body.data,
        idempotencyKey: requestIdempotencyKey(request),
        requestId: request.id,
      });
      return reply.status(201).send({ data: checkout, error: null });
    } catch (error) {
      return routeError(error, request, reply);
    }
  });

  app.post("/v1/billing/portal", async (request, reply) => {
    const body = portalSchema.safeParse(request.body);
    if (
      !body.success ||
      new URL(body.data.returnUrl).origin !== options.allowedReturnOrigin
    ) {
      return sendApiError(
        reply,
        request.id,
        400,
        "RETURN_URL_NOT_ALLOWED",
        "عنوان العودة غير مسموح.",
      );
    }
    try {
      const user = await requireUser(request, auth);
      return {
        data: await billing.createCustomerPortal({
          actor: user,
          returnUrl: body.data.returnUrl,
          requestId: request.id,
        }),
        error: null,
      };
    } catch (error) {
      return routeError(error, request, reply);
    }
  });

  app.post(
    "/v1/billing/checkouts/:checkoutId/complete-sandbox",
    async (request, reply) => {
      if (!options.sandbox) {
        return reply.status(404).send({
          data: null,
          error: {
            code: "NOT_FOUND",
            message: "المورد غير موجود.",
            requestId: request.id,
          },
        });
      }
      const params = paramsSchema.safeParse(request.params);
      if (!params.success) return reply.status(404).send();
      try {
        const user = await requireUser(request, auth);
        return {
          data: await billing.completeSandbox(
            params.data.checkoutId,
            user,
            request.id,
          ),
          error: null,
        };
      } catch (error) {
        return routeError(error, request, reply);
      }
    },
  );

  await app.register(async (webhookApp) => {
    webhookApp.removeContentTypeParser("application/json");
    webhookApp.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 256 * 1024 },
      (_request, body, done) => done(null, body),
    );
    webhookApp.post(
      "/v1/billing/webhooks/:providerId",
      { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
      async (request, reply) => {
        const params = webhookParamsSchema.safeParse(request.params);
        if (!params.success || !Buffer.isBuffer(request.body)) {
          return reply.status(400).send({
            data: null,
            error: {
              code: "WEBHOOK_EVENT_INVALID",
              message: "طلب Webhook غير صالح.",
              requestId: request.id,
            },
          });
        }
        try {
          const result = await billing.handleWebhook({
            providerId: params.data.providerId,
            rawBody: request.body,
            headers: request.headers,
            requestId: request.id,
          });
          return { data: result, error: null };
        } catch (error) {
          return routeError(error, request, reply);
        }
      },
    );
  });
}
