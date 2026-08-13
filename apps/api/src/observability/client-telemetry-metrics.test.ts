import { describe, expect, it } from "vitest";
import { ClientTelemetryMetrics } from "./client-telemetry-metrics.js";

describe("ClientTelemetryMetrics", () => {
  it("renders bounded error labels and cumulative LCP buckets", () => {
    const metrics = new ClientTelemetryMetrics();
    metrics.observeError("react");
    metrics.observeError("react");
    metrics.observeLcp(2_000);
    metrics.observeLcp(5_000);

    expect(metrics.render().join("\n")).toContain(
      'motionprep_client_errors_total{kind="react"} 2',
    );
    expect(metrics.render().join("\n")).toContain(
      'motionprep_client_lcp_seconds_bucket{le="2.5"} 1',
    );
    expect(metrics.render().join("\n")).toContain(
      'motionprep_client_lcp_seconds_bucket{le="8"} 2',
    );
    expect(metrics.render().join("\n")).toContain(
      "motionprep_client_lcp_seconds_count 2",
    );
  });
});
