import { describe, expect, it } from "vitest";
import { initializeTracing, traceContextFromCarrier } from "./tracing.js";

describe("trace context", () => {
  it("accepts valid W3C trace context", () => {
    expect(
      traceContextFromCarrier({
        traceparent:
          "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        tracestate: "vendor=value",
      }),
    ).toEqual({
      traceparent:
        "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      tracestate: "vendor=value",
    });
  });

  it.each([
    "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
    "00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01",
    "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    "not-a-trace-parent",
  ])("rejects an invalid traceparent: %s", (traceparent) => {
    expect(traceContextFromCarrier({ traceparent })).toBeUndefined();
  });

  it("remains disabled when no exporter endpoint is configured", () => {
    expect(initializeTracing("motionprep-test", {}).enabled).toBe(false);
  });

  it("rejects insecure production exporters before startup", () => {
    expect(() =>
      initializeTracing("motionprep-test", {
        NODE_ENV: "production",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://collector.test/v1/traces",
      }),
    ).toThrow("must use HTTPS in production");
  });
});
