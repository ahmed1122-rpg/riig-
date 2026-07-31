import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import {
  createAppTestHarness,
  registerCreator,
} from "./app-test-helpers.js";

const harness = createAppTestHarness();

describe("API — الرفع وإصدارات المصدر", () => {
  it("creates a project and a matching upload intent", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);

    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "شخصية المعلّم", kind: "image" },
    });
    expect(projectResponse.statusCode).toBe(201);
    const projectId = projectResponse.json().data.id as string;

    const uploadResponse = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "teacher.png",
        contentType: "image/png",
        sizeBytes: 1024,
      },
    });

    expect(uploadResponse.statusCode).toBe(201);
    expect(uploadResponse.json().data.maxBytes).toBe(30 * 1024 * 1024);
    expect(uploadResponse.json().data.objectKey).toMatch(
      new RegExp(`^sources/${projectId}/.+\\.png$`),
    );
    expect(uploadResponse.json().data.status).toBe("uploading");
  });
  it("rejects an oversized file on the server", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const response = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId: crypto.randomUUID(),
        filename: "large.pdf",
        contentType: "application/pdf",
        sizeBytes: 30 * 1024 * 1024 + 1,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("UPLOAD_REJECTED");
  });
  it("allows only one active upload per project and reuses an idempotent request", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "كتاب تجريبي", kind: "book" },
    });
    const projectId = projectResponse.json().data.id as string;
    const payload = {
      projectId,
      filename: "book.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
    };

    const first = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: {
        cookie,
        "x-idempotency-key": "upload-book-001",
      },
      payload,
    });
    const repeated = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: {
        cookie,
        "x-idempotency-key": "upload-book-001",
      },
      payload,
    });
    const conflicting = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: {
        cookie,
        "x-idempotency-key": "upload-book-002",
      },
      payload,
    });

    expect(repeated.json().data.uploadId).toBe(first.json().data.uploadId);
    expect(conflicting.statusCode).toBe(409);
    expect(conflicting.json().error.code).toBe("ACTIVE_UPLOAD_EXISTS");
  });
  it("verifies stored bytes on the server and repeats the upload idempotently", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "صورة مرشد", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "guide.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
      },
    });
    const completed = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "image/png" },
      payload: png,
    });
    const repeated = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "image/png" },
      payload: png,
    });

    expect(completed.statusCode).toBe(200);
    expect(completed.json().data.status).toBe("ready");
    expect(completed.json().data.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(completed.json().data.sourceVersionId).toBeTruthy();
    expect(repeated.json().data.sourceVersionId).toBe(
      completed.json().data.sourceVersionId,
    );
    expect(repeated.json().data.sha256).toBe(completed.json().data.sha256);
  });
  it("does not expose the former client-asserted completion endpoint", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);

    const response = await app.inject({
      method: "POST",
      url: `/v1/uploads/${crypto.randomUUID()}/complete`,
      headers: { cookie },
      payload: {
        observedContentType: "image/png",
        observedSizeBytes: 1,
        sha256: "a".repeat(64),
      },
    });

    expect(response.statusCode).toBe(404);
  });
  it("receives file bytes, detects their type, and computes the hash on the server", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "رفع صورة حقيقي", kind: "image" },
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId: projectResponse.json().data.id,
        filename: "source.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
      },
    });

    const uploaded = await app.inject({
      method: "PUT",
      url: intent.json().data.uploadUrl,
      headers: { cookie, "content-type": "image/png" },
      payload: png,
    });

    expect(uploaded.statusCode).toBe(200);
    expect(uploaded.json().data.status).toBe("ready");
    expect(uploaded.json().data.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(uploaded.json().data.sourceVersionId).toBeTruthy();
  });
  it("keeps replacements as numbered source versions in the same project", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "مشروع متعدد الإصدارات", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const uploadVersion = async (filename: string, replace: boolean) => {
      const intent = await app!.inject({
        method: "POST",
        url: "/v1/uploads/intents",
        headers: {
          cookie,
          "x-idempotency-key": `version-${filename}`,
        },
        payload: {
          projectId,
          filename,
          contentType: "image/png",
          sizeBytes: png.byteLength,
          replaceSourceVersion: replace,
        },
      });
      expect(intent.statusCode).toBe(201);
      const uploaded = await app!.inject({
        method: "PUT",
        url: intent.json().data.uploadUrl,
        headers: { cookie, "content-type": "image/png" },
        payload: png,
      });
      expect(uploaded.statusCode).toBe(200);
      return uploaded.json().data.sourceVersionId as string;
    };

    const firstSourceVersionId = await uploadVersion("first.png", false);
    const unconfirmedReplacement = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: {
        cookie,
        "x-idempotency-key": "version-unconfirmed.png",
      },
      payload: {
        projectId,
        filename: "unconfirmed.png",
        contentType: "image/png",
        sizeBytes: png.byteLength,
        replaceSourceVersion: false,
      },
    });
    const secondSourceVersionId = await uploadVersion("second.png", true);
    const versionsResponse = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/source-versions`,
      headers: { cookie },
    });
    const projectsResponse = await app.inject({
      method: "GET",
      url: "/v1/projects",
      headers: { cookie },
    });

    expect(secondSourceVersionId).not.toBe(firstSourceVersionId);
    expect(unconfirmedReplacement.statusCode).toBe(409);
    expect(unconfirmedReplacement.json().error.code).toBe(
      "SOURCE_REPLACEMENT_CONFIRMATION_REQUIRED",
    );
    expect(versionsResponse.statusCode).toBe(200);
    expect(
      versionsResponse.json().data.map(
        (version: { id: string; versionNumber: number }) => ({
          id: version.id,
          versionNumber: version.versionNumber,
        }),
      ),
    ).toEqual([
      { id: secondSourceVersionId, versionNumber: 2 },
      { id: firstSourceVersionId, versionNumber: 1 },
    ]);
    expect(projectsResponse.json().data[0]).toMatchObject({
      id: projectId,
      currentSourceVersionId: secondSourceVersionId,
      currentSourceVersionNumber: 2,
    });
  });
  it("rejects disguised upload content and marks the session as failed", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "ملف متنكر", kind: "image" },
    });
    const disguised = Buffer.from("%PDF-1.7\n");
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId: projectResponse.json().data.id,
        filename: "not-really.png",
        contentType: "image/png",
        sizeBytes: disguised.byteLength,
      },
    });
    const uploadId = intent.json().data.uploadId as string;

    const rejected = await app.inject({
      method: "PUT",
      url: `/v1/uploads/${uploadId}/content`,
      headers: { cookie, "content-type": "image/png" },
      payload: disguised,
    });
    const status = await app.inject({
      method: "GET",
      url: `/v1/uploads/${uploadId}`,
      headers: { cookie },
    });

    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("UPLOAD_TYPE_MISMATCH");
    expect(status.json().data.status).toBe("failed");
  });
  it("cancels an active upload safely", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectResponse = await app.inject({
      method: "POST",
      url: "/v1/projects",
      headers: { cookie },
      payload: { name: "صورة قابلة للإلغاء", kind: "image" },
    });
    const projectId = projectResponse.json().data.id as string;
    const intent = await app.inject({
      method: "POST",
      url: "/v1/uploads/intents",
      headers: { cookie },
      payload: {
        projectId,
        filename: "cancel.png",
        contentType: "image/png",
        sizeBytes: 1024,
      },
    });

    const cancelled = await app.inject({
      method: "POST",
      url: `/v1/uploads/${intent.json().data.uploadId}/cancel`,
      headers: { cookie },
    });
    expect(cancelled.json().data.status).toBe("cancelled");
  });
});
