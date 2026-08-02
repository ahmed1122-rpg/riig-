import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

describe("central HTTP error contract", () => {
  it("returns one safe envelope for an unexpected route failure", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }));
    app.get("/v1/__test/unexpected", async () => {
      throw new Error("database password must not leave the server");
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/__test/unexpected",
    });
    const payload = response.json();

    expect(response.statusCode).toBe(500);
    expect(payload).toEqual({
      data: null,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: expect.any(String),
        requestId: response.headers["x-request-id"],
      },
    });
    expect(response.body).not.toContain("database password");
    expect(response.headers["cache-control"]).toBe("no-store");
    await app.close();
  });

  it("normalizes Fastify schema validation failures", async () => {
    const app = await buildApp(loadConfig({ NODE_ENV: "test" }));
    app.post(
      "/v1/__test/validated",
      {
        schema: {
          body: {
            type: "object",
            required: ["name"],
            properties: { name: { type: "string", minLength: 1 } },
          },
        },
      },
      async () => ({ data: { accepted: true }, error: null }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/v1/__test/validated",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      data: null,
      error: {
        code: "REQUEST_VALIDATION_FAILED",
        message: "بيانات الطلب غير صالحة.",
        requestId: response.headers["x-request-id"],
      },
    });
    await app.close();
  });
});
