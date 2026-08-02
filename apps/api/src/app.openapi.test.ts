import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

describe("OpenAPI discovery", () => {
  it("publishes the registered public API without documenting itself", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }));
    const response = await app.inject({
      method: "GET",
      url: "/v1/openapi.json",
    });
    const document = response.json();

    expect(response.statusCode).toBe(200);
    expect(document.openapi).toBe("3.1.0");
    expect(document.info.version).toBe("0.1.3");
    expect(document.paths).toHaveProperty("/v1/health/ready");
    expect(document.paths).toHaveProperty("/v1/capabilities");
    expect(document.paths).toHaveProperty("/v1/auth/login");
    expect(document.paths).toHaveProperty("/v1/projects");
    expect(document.paths).not.toHaveProperty("/v1/openapi.json");
    expect(document.paths).not.toHaveProperty("/internal/metrics");

    const operations = Object.values(
      document.paths as Record<string, Record<string, unknown>>,
    ).flatMap((path) =>
        Object.values(path).filter(
          (operation) =>
            typeof operation === "object" &&
            operation !== null &&
            "responses" in operation,
        ) as Array<Record<string, unknown>>,
    );
    expect(operations.length).toBeGreaterThan(50);
    expect(
      operations.filter((operation) => "requestBody" in operation).length,
    ).toBeGreaterThanOrEqual(20);
    expect(
      operations.every(
        (operation) =>
          typeof operation.summary === "string" &&
          Array.isArray(operation.tags) &&
          Array.isArray(operation.security) &&
          typeof operation.responses === "object",
      ),
    ).toBe(true);
    expect(document.paths["/v1/projects"].get.security).toEqual([
      { sessionCookie: [] },
    ]);
    expect(document.paths["/v1/auth/login"].post.security).toEqual([]);

    await app.close();
  });
});
