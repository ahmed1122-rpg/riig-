import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

describe("runtime capabilities", () => {
  it("reports disabled OCR truthfully with the enforced limits", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/capabilities",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      schemaVersion: "1.0",
      limits: { maxUploadBytes: 30 * 1024 * 1024, maxPdfPages: 250 },
      features: {
        characterRig: {
          enabled: false,
          unavailableReason: expect.any(String),
          requiredCanonicalViews: 5,
        },
        pdfRegionOcr: {
          enabled: false,
          unavailableReason: expect.any(String),
        },
      },
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
