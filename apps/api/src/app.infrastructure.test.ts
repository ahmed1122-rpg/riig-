import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { createAppTestHarness } from "./app-test-helpers.js";
import type { RateLimitStoreConstructor } from "./infrastructure/redis/redis-rate-limit-store.js";

const harness = createAppTestHarness();

describe("API — البنية التحتية", () => {
  it("exposes the application and immutable release identities in health", async () => {
    const release = "b".repeat(40);
    const app = await harness.build(
      loadConfig({ NODE_ENV: "test", RELEASE_VERSION: release }),
    );

    const response = await app.inject({ method: "GET", url: "/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      status: "ok",
      service: "motionprep-api",
      version: "0.1.2",
      release,
    });
  });

  it("keeps readiness independent from an unavailable distributed rate limiter", async () => {
    class FailingRateLimitStore {
      incr(
        _key: string,
        callback: (error: Error) => void,
        _timeWindow: number,
        _max: number,
      ) {
        callback(new Error("Redis unavailable"));
      }

      child() {
        return this;
      }
    }
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      rateLimitStore:
        FailingRateLimitStore as unknown as RateLimitStoreConstructor,
      readiness: async () => {
        throw new Error("Redis unavailable");
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/health/ready",
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("DEPENDENCY_UNAVAILABLE");
  });

  it("exposes bounded internal HTTP metrics without raw request paths", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    await app.inject({
      method: "GET",
      url: "/v1/health?user=private-value",
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/metrics",
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain(
      'motionprep_http_requests_total{method="GET",route="/v1/health",status="200"} 1',
    );
    expect(response.body).toContain(
      "motionprep_http_request_duration_seconds_bucket",
    );
    expect(response.body).not.toContain("private-value");
  });

  it("protects internal metrics when a bearer token is configured", async () => {
    const token = "metrics-test-token-at-least-32-characters";
    const app = await harness.build(
      loadConfig({
        NODE_ENV: "test",
        METRICS_BEARER_TOKEN: token,
      }),
    );

    const denied = await app.inject({
      method: "GET",
      url: "/internal/metrics",
    });
    const allowed = await app.inject({
      method: "GET",
      url: "/internal/metrics",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(denied.statusCode).toBe(401);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toContain("motionprep_process_uptime_seconds");
  });

  it("publishes queue, worker, dependency, and job-duration signals", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      readiness: async () => undefined,
      operationalStatus: {
        async snapshot() {
          return {
            status: "ready" as const,
            workers: [
              {
                instanceId: "media-1",
                workerType: "media" as const,
                releaseVersion: "sha-test",
                concurrency: 2,
                lastSeenAt: "2026-07-29T00:00:00.000Z",
                stale: false,
              },
            ],
            queues: [
              {
                queue: "processing-media" as const,
                queued: 3,
                active: 1,
                failed: 2,
                oldestQueuedSeconds: 301,
                retriesLastHour: 4,
                leaseLossesLastHour: 1,
                duration: {
                  count: 5,
                  sumSeconds: 12.5,
                  buckets: [1, 2, 4, 5, 5, 5, 5, 5],
                },
              },
            ],
            maintenance: {
              task: "retention" as const,
              lastStartedAt: "2026-07-29T00:00:00.000Z",
              lastSucceededAt: "2026-07-29T00:01:00.000Z",
              lastFailedAt: null,
              lastError: null,
              stale: false,
            },
            checkedAt: "2026-07-29T00:00:00.000Z",
          };
        },
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/metrics",
    });

    expect(response.body).toContain(
      'motionprep_queue_oldest_queued_seconds{queue="processing-media"} 301.000',
    );
    expect(response.body).toContain(
      'motionprep_worker_events_last_hour{queue="processing-media",event="lease_lost"} 1',
    );
    expect(response.body).toContain(
      'motionprep_job_duration_seconds_bucket{queue="processing-media",le="15"} 4',
    );
    expect(response.body).toContain(
      'motionprep_worker_up{worker_type="media",instance="media-1",release="sha-test"} 1',
    );
    expect(response.body).toContain(
      'motionprep_worker_up{worker_type="document",instance="missing",release="unknown"} 0',
    );
    expect(response.body).toContain(
      'motionprep_worker_up{worker_type="export",instance="missing",release="unknown"} 0',
    );
    expect(response.body).toContain("motionprep_dependencies_ready 1");
    expect(response.body).toContain(
      'motionprep_maintenance_stale{task="retention"} 0',
    );
    expect(response.body).toContain("motionprep_process_resident_memory_bytes");
    expect(response.body).toContain("motionprep_process_cpu_seconds_total");
  });

  it("reports dependency readiness failure without failing metrics", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }), {
      readiness: async () => {
        throw new Error("dependency unavailable");
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/internal/metrics",
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("motionprep_dependencies_ready 0");
  });

  it("allows the browser upload method from a configured development origin", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const response = await app.inject({
      method: "OPTIONS",
      url: `/v1/uploads/${crypto.randomUUID()}/content`,
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "PUT",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://127.0.0.1:5173",
    );
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
  });
});
