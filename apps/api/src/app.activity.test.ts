import { describe, expect, it } from "vitest";
import { createAppTestHarness, registerCreator } from "./app-test-helpers.js";
import { loadConfig } from "./config.js";

const harness = createAppTestHarness();

describe("API — creator activity", () => {
  it("requires authentication and returns only the creator's workflow", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const ownerCookie = await registerCreator(app, "activity-owner@example.com");
    const otherCookie = await registerCreator(app, "activity-other@example.com");
    const owned = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie: ownerCookie },
      payload: { name: "Owned activity", kind: "image" },
    });
    await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie: otherCookie },
      payload: { name: "Private activity", kind: "book" },
    });

    const anonymous = await app.inject({ method: "GET", url: "/v1/activity" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/activity?limit=5",
      headers: { cookie: ownerCookie },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      items: [
        {
          kind: "upload",
          status: "pending",
          project: { id: owned.json().data.id, name: "Owned activity" },
        },
      ],
      summary: { active: 0, needsAttention: 0, failed: 0 },
      nextCursor: null,
    });
  });

  it("reports an invalid activity cursor instead of silently resetting", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app, "activity-cursor@example.com");
    const response = await app.inject({
      method: "GET",
      url: "/v1/activity?cursor=broken",
      headers: { cookie },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("ACTIVITY_CURSOR_INVALID");
  });
});
