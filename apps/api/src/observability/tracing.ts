import {
  context,
  propagation,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Span,
  type TextMapGetter,
  type TextMapSetter,
} from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import {
  defaultResource,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { TraceContext } from "@motionprep/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";

const TRACE_PARENT_PATTERN =
  /^(?!ff)[0-9a-f]{2}-(?!0{32})[0-9a-f]{32}-(?!0{16})[0-9a-f]{16}-[0-9a-f]{2}$/;
const MAX_TRACE_STATE_LENGTH = 512;
const tracer = trace.getTracer("@motionprep/api");
const requestSpans = new WeakMap<FastifyRequest, RequestSpan>();

interface RequestSpan {
  span: Span;
  spanContext: Context;
  ended: boolean;
}

export interface TracingEnvironment {
  NODE_ENV?: string;
  RELEASE_VERSION?: string;
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;
}

export interface TracingHandle {
  enabled: boolean;
  shutdown(): Promise<void>;
}

let activeSdk: NodeSDK | null = null;
let activeServiceName: string | null = null;

export function initializeTracing(
  serviceName: string,
  environment: TracingEnvironment = process.env,
): TracingHandle {
  const endpoint = environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim();
  if (!endpoint) return disabledTracingHandle;

  const endpointUrl = new URL(endpoint);
  if (!(["http:", "https:"] as const).includes(endpointUrl.protocol as never)) {
    throw new Error("OTLP traces endpoint must use HTTP or HTTPS.");
  }
  if (environment.NODE_ENV === "production" && endpointUrl.protocol !== "https:") {
    throw new Error("OTLP traces endpoint must use HTTPS in production.");
  }
  if (endpointUrl.username || endpointUrl.password) {
    throw new Error("OTLP traces endpoint must not contain credentials.");
  }

  if (activeSdk) {
    if (activeServiceName !== serviceName) {
      throw new Error(
        `Tracing is already initialized for ${activeServiceName ?? "another service"}.`,
      );
    }
    return activeTracingHandle;
  }

  const resource = defaultResource().merge(
    resourceFromAttributes({
      "service.name": serviceName,
      "service.version": environment.RELEASE_VERSION ?? "development",
      "deployment.environment.name": environment.NODE_ENV ?? "development",
    }),
  );
  activeSdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({ url: endpointUrl.toString() }),
  });
  activeServiceName = serviceName;
  activeSdk.start();
  return activeTracingHandle;
}

const disabledTracingHandle: TracingHandle = {
  enabled: false,
  shutdown: async () => undefined,
};

const activeTracingHandle: TracingHandle = {
  enabled: true,
  shutdown: async () => {
    const sdk = activeSdk;
    activeSdk = null;
    activeServiceName = null;
    await sdk?.shutdown();
  },
};

export function registerHttpTracing(app: FastifyInstance): void {
  app.addHook("onRequest", async (request) => {
    const parent = traceContextFromCarrier(request.headers);
    const parentContext = parent
      ? propagation.extract(
          context.active(),
          { ...parent } satisfies Record<string, unknown>,
          traceContextGetter,
        )
      : context.active();
    const route = request.routeOptions.url;
    const span = tracer.startSpan(
      `${request.method} ${route}`,
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.request.method": request.method,
          "http.route": route,
          "server.address": request.hostname,
          "url.path": request.url.split("?", 1)[0] ?? request.url,
          "motionprep.request.id": request.id,
        },
      },
      parentContext,
    );
    requestSpans.set(request, {
      span,
      spanContext: trace.setSpan(parentContext, span),
      ended: false,
    });
  });

  app.addHook("onError", async (request, _reply, error) => {
    const state = requestSpans.get(request);
    if (!state || state.ended) return;
    state.span.recordException(error);
    state.span.setStatus({ code: SpanStatusCode.ERROR });
  });

  app.addHook("onResponse", async (request, reply) => {
    const state = requestSpans.get(request);
    if (!state || state.ended) return;
    state.ended = true;
    state.span.setAttribute("http.response.status_code", reply.statusCode);
    if (reply.statusCode >= 500) {
      state.span.setStatus({ code: SpanStatusCode.ERROR });
    } else {
      state.span.setStatus({ code: SpanStatusCode.OK });
    }
    state.span.end();
    requestSpans.delete(request);
  });
}

export function requestTraceContext(
  request: Pick<FastifyRequest, "headers">,
): TraceContext | undefined {
  const state = requestSpans.get(request as FastifyRequest);
  if (state) {
    const carrier: Record<string, string> = {};
    propagation.inject(state.spanContext, carrier, traceContextSetter);
    const injected = traceContextFromCarrier(carrier);
    if (injected) return injected;
  }
  return traceContextFromCarrier(request.headers);
}

export async function withJobTrace<T>(
  operation: string,
  job: {
    id: string;
    projectId: string;
    correlationId?: string;
    traceContext?: TraceContext;
  },
  run: () => Promise<T>,
): Promise<T> {
  const parentContext = job.traceContext
    ? propagation.extract(
        context.active(),
        { ...job.traceContext } satisfies Record<string, unknown>,
        traceContextGetter,
      )
    : context.active();
  return tracer.startActiveSpan(
    operation,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        "motionprep.job.id": job.id,
        "motionprep.project.id": job.projectId,
        ...(job.correlationId
          ? { "motionprep.correlation.id": job.correlationId }
          : {}),
      },
    },
    parentContext,
    async (span) => {
      try {
        const result = await run();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        if (error instanceof Error) span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export function traceContextFromCarrier(
  carrier: Record<string, unknown>,
): TraceContext | undefined {
  const traceparent = singleHeader(carrier.traceparent);
  if (!traceparent || !TRACE_PARENT_PATTERN.test(traceparent)) return undefined;
  const tracestate = singleHeader(carrier.tracestate);
  return {
    traceparent,
    ...(tracestate && tracestate.length <= MAX_TRACE_STATE_LENGTH
      ? { tracestate }
      : {}),
  };
}

function singleHeader(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return undefined;
  const trimmed = candidate.trim();
  return trimmed || undefined;
}

const traceContextGetter: TextMapGetter<Record<string, unknown>> = {
  keys: (carrier) => Object.keys(carrier),
  get: (carrier, key) => {
    const value = carrier[key];
    if (Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
    return typeof value === "string" ? value : undefined;
  },
};

const traceContextSetter: TextMapSetter<Record<string, string>> = {
  set: (carrier, key, value) => {
    carrier[key] = value;
  },
};
