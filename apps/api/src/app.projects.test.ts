import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  createAppTestHarness,
  registerCreator,
} from "./app-test-helpers.js";

const harness = createAppTestHarness();
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("API — استعادة إصدار المصدر", () => {
  it("restores a ready version with a precondition and replays one event", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "تاريخ المصدر", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;
    const first = await uploadVersion(app, cookie, projectId, "first.png");
    const second = await uploadVersion(app, cookie, projectId, "second.png");
    const request = {
      method: "POST" as const,
      url: `/v1/projects/${projectId}/source-versions/${first}/restore`,
      headers: {
        cookie,
        "x-idempotency-key": "restore-first-version-001",
      },
      payload: {
        expectedCurrentSourceVersionId: second,
        reason: "العودة إلى النسخة التي اعتمدها فريق المراجعة.",
      },
    };

    const restored = await app.inject(request);
    const replayed = await app.inject(request);
    const history = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/source-version-restores`,
      headers: { cookie },
    });
    const originatingRequestId = restored.headers["x-request-id"] as string;

    expect(restored.statusCode).toBe(201);
    expect(restored.json().data).toMatchObject({
      replayed: false,
      project: {
        currentSourceVersionId: first,
        currentSourceVersionNumber: 1,
        status: "needs_review",
      },
      event: {
        fromSourceVersionId: second,
        toSourceVersionId: first,
        idempotencyKey: "restore-first-version-001",
        originatingRequestId,
        requestId: "restore-first-version-001",
        operationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      },
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json().data.replayed).toBe(true);
    expect(replayed.json().data.event.id).toBe(
      restored.json().data.event.id,
    );
    expect(replayed.json().data.event.operationId).toBe(
      restored.json().data.event.operationId,
    );
    expect(replayed.json().data.event.originatingRequestId).toBe(
      originatingRequestId,
    );
    expect(replayed.headers["x-request-id"]).not.toBe(originatingRequestId);
    expect(history.statusCode).toBe(200);
    expect(history.json().data).toHaveLength(1);
    expect(history.json().data[0]).toMatchObject(
      restored.json().data.event,
    );
  });

  it("rejects stale preconditions and reused keys with different intent", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app, "restore-owner@example.com");
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "تعارض المصدر", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;
    const first = await uploadVersion(app, cookie, projectId, "v1.png");
    const second = await uploadVersion(app, cookie, projectId, "v2.png");
    const firstRestore = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/source-versions/${first}/restore`,
      headers: {
        cookie,
        "x-idempotency-key": "restore-conflict-001",
      },
      payload: {
        expectedCurrentSourceVersionId: second,
        reason: "استعادة النسخة الأولى للمراجعة.",
      },
    });
    const reused = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/source-versions/${second}/restore`,
      headers: {
        cookie,
        "x-idempotency-key": "restore-conflict-001",
      },
      payload: {
        expectedCurrentSourceVersionId: first,
        reason: "عملية مختلفة بالمفتاح نفسه.",
      },
    });
    const stale = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/source-versions/${second}/restore`,
      headers: {
        cookie,
        "x-idempotency-key": "restore-conflict-002",
      },
      payload: {
        expectedCurrentSourceVersionId: second,
        reason: "محاولة مبنية على مؤشر قديم.",
      },
    });

    expect(firstRestore.statusCode).toBe(201);
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe("SOURCE_VERSION_CONFLICT");
  });
});

async function uploadVersion(
  app: Awaited<ReturnType<typeof harness.build>>,
  cookie: string,
  projectId: string,
  filename: string,
): Promise<string> {
  const intent = await app.inject({
    method: "POST",
    url: "/v1/uploads/intents",
    headers: {
      cookie,
      "x-idempotency-key": `intent-${filename}-${crypto.randomUUID()}`,
    },
    payload: {
      projectId,
      filename,
      contentType: "image/png",
      sizeBytes: onePixelPng.byteLength,
      replaceSourceVersion: true,
    },
  });
  expect(intent.statusCode).toBe(201);
  const completed = await app.inject({
    method: "PUT",
    url: `/v1/uploads/${intent.json().data.uploadId}/content`,
    headers: { cookie, "content-type": "image/png" },
    payload: onePixelPng,
  });
  expect(completed.statusCode).toBe(200);
  return completed.json().data.sourceVersionId as string;
}
