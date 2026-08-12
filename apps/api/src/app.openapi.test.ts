import { describe, expect, it } from "vitest";
import { APPLICATION_VERSION, buildApp } from "./app.js";
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
    expect(document.info.version).toBe(APPLICATION_VERSION);
    expect(document.paths).toHaveProperty("/v1/health/ready");
    expect(document.paths).toHaveProperty("/v1/capabilities");
    expect(document.paths).toHaveProperty("/v1/auth/login");
    expect(document.paths).toHaveProperty("/v1/account/export");
    expect(document.paths).toHaveProperty("/v1/account");
    expect(document.paths).toHaveProperty("/v1/projects");
    expect(document.paths).toHaveProperty("/v1/activity");
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
    expect(
      document.paths["/v1/auth/register"].post.requestBody.content[
        "application/json"
      ].schema.required,
    ).toContain("legal");
    expect(
      document.paths["/v1/processing/jobs"].post.requestBody.content[
        "application/json"
      ].schema,
    ).toMatchObject({
      required: ["projectId", "sourceVersionId"],
      properties: {
        projectId: { type: "string", format: "uuid" },
        sourceVersionId: { type: "string", format: "uuid" },
      },
    });
    expect(
      document.paths["/v1/processing/jobs"].post.requestBody.content[
        "application/json"
      ].schema.properties,
    ).not.toHaveProperty("projectKind");
    expect(document.paths).toHaveProperty("/v1/admin/exports");
    expect(
      document.paths["/v1/admin/exports/{jobId}/retry"].post.requestBody
        .content["application/json"].schema.required,
    ).toEqual(["reason"]);
    const publicExportSchema =
      document.paths["/v1/exports"].get.responses["200"].content[
        "application/json"
      ].schema.properties.data.items;
    const adminExportSchema =
      document.paths["/v1/admin/exports"].get.responses["200"].content[
        "application/json"
      ].schema.properties.data.items;
    const processingSchema =
      document.paths["/v1/processing/jobs"].post.responses["202"].content[
        "application/json"
      ].schema.properties.data;
    expect(publicExportSchema.required).toContain("documentRevision");
    expect(publicExportSchema.properties.artifact.properties).not.toHaveProperty(
      "objectKey",
    );
    expect(adminExportSchema.required).toContain("traceId");
    expect(adminExportSchema.properties).not.toHaveProperty("traceContext");
    expect(adminExportSchema.properties).not.toHaveProperty("maxAttempts");
    expect(adminExportSchema.properties).not.toHaveProperty("errorCode");
    expect(processingSchema.required).toContain("options");
    expect(
      document.paths["/v1/activity"].get.responses["200"].content[
        "application/json"
      ].schema.properties.data.required,
    ).toEqual(["items", "summary", "nextCursor", "generatedAt"]);

    const characterOperations = [
      ["/v1/projects/{projectId}/character-rig", "get"],
      ["/v1/projects/{projectId}/character-rig/bible", "put"],
      ["/v1/projects/{projectId}/character-rig/bible/approve", "post"],
      ["/v1/projects/{projectId}/character-rig/references/current-source", "post"],
      ["/v1/projects/{projectId}/character-rig/identity-model", "post"],
      ["/v1/projects/{projectId}/character-rig/generations", "post"],
      [
        "/v1/projects/{projectId}/character-rig/generations/{generationAttemptId}/reviews",
        "post",
      ],
      [
        "/v1/projects/{projectId}/character-rig/generations/{generationAttemptId}/artifact",
        "get",
      ],
      ["/v1/projects/{projectId}/character-rig/compile", "post"],
    ] as const;
    for (const [path, method] of characterOperations) {
      const operation = document.paths[path][method];
      expect(operation.tags).toEqual(["character-rig"]);
      expect(operation.summary).not.toBe(`${method.toUpperCase()} ${path}`);
      expect(
        Object.keys(operation.responses).some((statusCode) => /^2\d\d$/.test(statusCode)),
      ).toBe(true);
    }
    for (const [path, method] of characterOperations.filter(
      ([, method]) => method !== "get",
    )) {
      expect(document.paths[path][method].requestBody.content).toHaveProperty(
        "application/json",
      );
    }
    expect(
      document.paths["/v1/projects/{projectId}/character-rig/generations"].post
        .requestBody.content["application/json"].schema.required,
    ).toEqual(["bibleId", "identityModelVersionId", "target", "controls"]);
    expect(
      document.paths["/v1/projects/{projectId}/character-rig/identity-model"]
        .post.responses["202"].content["application/json"].schema.properties
        .data.required,
    ).toEqual(["modelVersion", "job"]);

    await app.close();
  });
});
