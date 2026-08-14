import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { createAppTestHarness, TEST_PASSWORD } from "./app-test-helpers.js";
import { loadConfig } from "./config.js";

const harness = createAppTestHarness();

interface RateLimitCase {
  path: string;
  max: number;
  payload?: Record<string, string>;
}

describe("API — sensitive authentication rate limits", () => {
  it.each<RateLimitCase>([
    { path: "/v1/auth/mfa/setup", max: 10 },
    {
      path: "/v1/auth/mfa/setup/confirm",
      max: 10,
      payload: { setupToken: "x".repeat(32), code: "000000" },
    },
    {
      path: "/v1/auth/mfa/disable",
      max: 5,
      payload: { password: TEST_PASSWORD, code: "000000" },
    },
    {
      path: "/v1/auth/password/change",
      max: 5,
      payload: { currentPassword: TEST_PASSWORD, newPassword: `${TEST_PASSWORD}2` },
    },
  ])("throttles $path independently", async ({ path, max, payload }) => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));

    await expectUnauthenticatedUntilLimit(app, path, max, payload);
  });
});

async function expectUnauthenticatedUntilLimit(
  app: FastifyInstance,
  path: string,
  max: number,
  payload?: Record<string, string>,
): Promise<void> {
  for (let attempt = 0; attempt < max; attempt += 1) {
    const response = await injectRequest(app, path, payload);
    expect(response.statusCode).toBe(401);
  }

  const throttled = await injectRequest(app, path, payload);
  expect(throttled.statusCode).toBe(429);
}

function injectRequest(
  app: FastifyInstance,
  path: string,
  payload?: Record<string, string>,
) {
  return app.inject({
    method: "POST",
    url: path,
    ...(payload ? { payload } : {}),
  });
}
