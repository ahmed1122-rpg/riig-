import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import type { OperationalStatusSnapshot } from "./observability/operational-status.js";

const operationalSnapshot: OperationalStatusSnapshot = {
  status: "degraded",
  workers: [],
  queues: [],
  emailOutbox: null,
  maintenance: null,
  checkedAt: "2026-08-12T00:00:00.000Z",
};

describe("runtime capabilities", () => {
  it("reports disabled OCR truthfully with the enforced limits", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/capabilities",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      schemaVersion: "1.2",
      limits: {
        maxUploadBytes: 30 * 1024 * 1024,
        maxImageUploadBytes: 30 * 1024 * 1024,
        maxPdfUploadBytes: 30 * 1024 * 1024,
        maxPdfPages: 250,
      },
      runtime: { storageProfile: "ephemeral" },
      features: {
        characterRig: {
          enabled: false,
          unavailableReason: expect.any(String),
          requiredCanonicalViews: 5,
          supportedProjectKinds: ["image"],
        },
        pdfRegionOcr: {
          enabled: false,
          unavailableReason: expect.any(String),
        },
      },
    });

    await app.close();
  });

  it("reports required worker degradation without taking down the API", async () => {
    const app = await buildApp(
      loadConfig({
        NODE_ENV: "test",
        PROCESSING_EXECUTION_MODE: "worker",
        EXPORT_EXECUTION_MODE: "worker",
      }),
      {
        operationalStatus: {
          async snapshot() {
            return operationalSnapshot;
          },
        },
      },
    );
    const response = await app.inject({ method: "GET", url: "/v1/capabilities" });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.runtime.workers).toMatchObject({
      media: { status: "degraded", reason: expect.stringContaining("heartbeat") },
      document: { status: "degraded", reason: expect.stringContaining("heartbeat") },
      export: { status: "degraded", reason: expect.stringContaining("heartbeat") },
      character: { status: "not_required", reason: null },
    });
    await app.close();
  });

  it("advertises Character Studio only after an explicit runtime opt-in", async () => {
    const app = await buildApp(
      loadConfig({ NODE_ENV: "test", CHARACTER_RIG_ENABLED: "true" }),
    );
    const response = await app.inject({ method: "GET", url: "/v1/capabilities" });

    expect(response.json().data.features.characterRig).toEqual({
      enabled: true,
      unavailableReason: null,
      requiredCanonicalViews: 5,
      supportedProjectKinds: ["image"],
    });
    await app.close();
  });

  it("keeps configured Character Studio unavailable without a fresh worker", async () => {
    const app = await buildApp(
      loadConfig({ NODE_ENV: "test", CHARACTER_RIG_ENABLED: "true" }),
      {
        operationalStatus: {
          async snapshot() {
            return operationalSnapshot;
          },
        },
      },
    );
    const response = await app.inject({ method: "GET", url: "/v1/capabilities" });

    expect(response.json().data.features.characterRig).toMatchObject({
      enabled: false,
      unavailableReason: expect.stringContaining("heartbeat"),
    });
    await app.close();
  });

  it("advertises configured Character Studio with a fresh worker heartbeat", async () => {
    const app = await buildApp(
      loadConfig({ NODE_ENV: "test", CHARACTER_RIG_ENABLED: "true" }),
      {
        operationalStatus: {
          async snapshot() {
            return {
              ...operationalSnapshot,
              status: "ready",
              workers: [
                {
                  instanceId: "character-1",
                  workerType: "character",
                  releaseVersion: "sha-test",
                  concurrency: 1,
                  residentMemoryBytes: 1,
                  heapUsedBytes: 1,
                  cpuUserSeconds: 0,
                  cpuSystemSeconds: 0,
                  lastSeenAt: operationalSnapshot.checkedAt,
                  stale: false,
                },
              ],
            } satisfies OperationalStatusSnapshot;
          },
        },
      },
    );
    const response = await app.inject({ method: "GET", url: "/v1/capabilities" });

    expect(response.json().data.features.characterRig).toMatchObject({
      enabled: true,
      unavailableReason: null,
    });
    await app.close();
  });

  it("reports OCR as available only when the runtime flag is enabled", async () => {
    const app = await buildApp(
      loadConfig({ NODE_ENV: "test", PDF_REGION_OCR_ENABLED: "true" }),
    );
    const response = await app.inject({
      method: "GET",
      url: "/v1/capabilities",
    });

    expect(response.json().data.features.pdfRegionOcr).toEqual({
      enabled: true,
      unavailableReason: null,
    });

    await app.close();
  });
});
