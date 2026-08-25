import type {
  CharacterBible,
  CharacterGenerationAttempt,
  CharacterIdentityModelVersion,
  CharacterReferenceAsset,
} from "@motionprep/contracts";
import { describe, expect, it, vi } from "vitest";
import { HttpCharacterInferenceProvider } from "./http-character-inference-provider.js";

const now = "2026-08-11T00:00:00.000Z";
const projectId = crypto.randomUUID();
const bible = makeBible();
const model = makeModel();
const references = [makeReference()];

describe("HttpCharacterInferenceProvider", () => {
  it("requires encrypted transport except for explicit localhost development", () => {
    expect(
      () =>
        new HttpCharacterInferenceProvider({
          baseUrl: "http://inference.internal/",
          apiKey: "a-secure-test-key",
          timeoutMilliseconds: 1_000,
        }),
    ).toThrow(/HTTPS/u);
    expect(
      () =>
        new HttpCharacterInferenceProvider({
          baseUrl: "http://localhost:9090/",
          apiKey: "a-secure-test-key",
          timeoutMilliseconds: 1_000,
          allowInsecureLocalhost: true,
        }),
    ).not.toThrow();
  });

  it("sends scoped metadata with authentication and parses training results", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        providerModelReference: "private:model-1",
        metrics: { loss: 0.1 },
      }),
    );
    const provider = createProvider(request);
    await expect(
      provider.trainIdentity({ bible, modelVersion: model, references }),
    ).resolves.toEqual({
      providerModelReference: "private:model-1",
      metrics: { loss: 0.1 },
    });
    const [url, init] = request.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://inference.internal/v1/identity-models");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer a-secure-test-key",
    );
    expect(String(init?.body)).toContain(references[0]?.artifact.objectKey);
    expect(String(init?.body)).not.toContain("body");
  });

  it("preserves an inference path prefix with or without a trailing slash", async () => {
    for (const baseUrl of [
      "https://inference.internal/private-api",
      "https://inference.internal/private-api/",
    ]) {
      const request = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          providerModelReference: "private:model-1",
          metrics: {},
        }),
      );
      const provider = new HttpCharacterInferenceProvider({
        baseUrl,
        apiKey: "a-secure-test-key",
        timeoutMilliseconds: 10_000,
        fetch: request,
      });
      await provider.trainIdentity({ bible, modelVersion: model, references });
      expect(String(request.mock.calls[0]?.[0])).toBe(
        "https://inference.internal/private-api/v1/identity-models",
      );
    }
  });

  it("returns a verified-storage descriptor for generated assets", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        artifact: {
          objectKey: `projects/${projectId}/character-rig/provider/output.png`,
          contentType: "image/png",
          sizeBytes: 123,
          sha256: "a".repeat(64),
        },
        geometry: {
          canvas: { width: 1024, height: 1024 },
          bounds: { x: 0, y: 0, width: 1024, height: 1024 },
        },
        qualityReport: {
          thresholdsSchemaVersion: 1,
          landmarkMeanHeadWidthRatio: 0.01,
          landmarkCriticalPointHeadWidthRatio: 0.02,
          proportionDeviationRatio: 0.01,
          paletteMeanDeltaE00: 1,
          heroMaterialDeltaE00: 2,
          outsideMaskChangedPixelRatio: 0,
          severeDefects: [],
          passedAutomatedGate: true,
        },
      }),
    );
    const attempt: CharacterGenerationAttempt = {
      id: crypto.randomUUID(),
      projectId,
      bibleId: bible.id,
      identityModelVersionId: model.id,
      target: { kind: "canonical-view", view: "left-profile" },
      status: "processing",
      controls: {
        canvas: { width: 1024, height: 1024 },
        seed: 1,
        poseReferenceId: null,
        depthReferenceId: null,
        maskReferenceId: null,
        parameters: {},
      },
      requestHash: "b".repeat(64),
      idempotencyKey: "generation-operation",
      outputArtifact: null,
      outputGeometry: null,
      qualityReport: null,
      failureCode: null,
      createdByUserId: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    const result = await createProvider(request).generate({
      bible,
      modelVersion: model,
      attempt,
      references,
      outputObjectKey:
        `projects/${bible.projectId}/character-rig/generations/${attempt.id}.png`,
    });
    expect(result.artifact).toMatchObject({
      kind: "stored-object",
      sizeBytes: 123,
    });
  });

  it("submits and polls an async serverless operation without duplicating work", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            operationId: "gpu-operation-1",
            statusUrl: "v1/operations/gpu-operation-1",
            retryAfterMilliseconds: 250,
          },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { status: "running", retryAfterMilliseconds: 500 },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "succeeded",
          result: {
            providerModelReference: "serverless:model-1",
            metrics: { coldStartMilliseconds: 1_200 },
          },
        }),
      );
    const delay = vi.fn(async (_milliseconds: number) => undefined);
    const events: Array<{ phase: string; status: string; pollCount: number }> = [];
    const provider = new HttpCharacterInferenceProvider({
      baseUrl: "https://inference.internal/",
      apiKey: "a-secure-test-key",
      protocol: "async-v1",
      timeoutMilliseconds: 10_000,
      operationTimeoutMilliseconds: 20_000,
      pollIntervalMilliseconds: 250,
      maxPollIntervalMilliseconds: 2_000,
      fetch: request,
      delay,
      onOperationEvent: (event) => events.push(event),
    });

    await expect(
      provider.trainIdentity({ bible, modelVersion: model, references }),
    ).resolves.toEqual({
      providerModelReference: "serverless:model-1",
      metrics: { coldStartMilliseconds: 1_200 },
    });

    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map((call) => call[1]?.method)).toEqual([
      "POST",
      "GET",
      "GET",
    ]);
    expect(request.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://inference.internal/v1/identity-models",
      "https://inference.internal/v1/operations/gpu-operation-1",
      "https://inference.internal/v1/operations/gpu-operation-1",
    ]);
    expect(
      request.mock.calls.map((call) =>
        new Headers(call[1]?.headers).get("x-idempotency-key"),
      ),
    ).toEqual([model.id, model.id, model.id]);
    expect(delay.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      250,
      500,
    ]);
    expect(events).toMatchObject([
      { phase: "submitted", status: "accepted", pollCount: 0 },
      { phase: "poll", status: "running", pollCount: 1 },
      { phase: "completed", status: "succeeded", pollCount: 2 },
    ]);
  });

  it("rejects async status URLs that could leak provider credentials", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          operationId: "gpu-operation-1",
          statusUrl: "https://attacker.example/steal",
        },
        { status: 202 },
      ),
    );
    const provider = new HttpCharacterInferenceProvider({
      baseUrl: "https://inference.internal/private-api/",
      apiKey: "a-secure-test-key",
      protocol: "async-v1",
      timeoutMilliseconds: 10_000,
      operationTimeoutMilliseconds: 20_000,
      fetch: request,
    });

    await expect(
      provider.trainIdentity({ bible, modelVersion: model, references }),
    ).rejects.toMatchObject({
      code: "CHARACTER_PROVIDER_STATUS_URL_INVALID",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("maps an async serverless capacity failure to a retryable provider code", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            operationId: "gpu-operation-1",
            statusUrl: "v1/operations/gpu-operation-1",
          },
          { status: 202 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          status: "failed",
          errorCode: "CAPACITY_EXHAUSTED",
        }),
      );
    const provider = new HttpCharacterInferenceProvider({
      baseUrl: "https://inference.internal/",
      apiKey: "a-secure-test-key",
      protocol: "async-v1",
      timeoutMilliseconds: 10_000,
      operationTimeoutMilliseconds: 20_000,
      pollIntervalMilliseconds: 250,
      fetch: request,
      delay: async () => undefined,
    });

    await expect(
      provider.trainIdentity({ bible, modelVersion: model, references }),
    ).rejects.toMatchObject({ code: "CHARACTER_PROVIDER_RATE_LIMITED" });
  });

  it("cancels an async operation while it is waiting to poll", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          operationId: "gpu-operation-1",
          statusUrl: "v1/operations/gpu-operation-1",
        },
        { status: 202 },
      ),
    );
    let markDelayStarted: (() => void) | undefined;
    const delayStarted = new Promise<void>((resolve) => {
      markDelayStarted = resolve;
    });
    const provider = new HttpCharacterInferenceProvider({
      baseUrl: "https://inference.internal/",
      apiKey: "a-secure-test-key",
      protocol: "async-v1",
      timeoutMilliseconds: 10_000,
      operationTimeoutMilliseconds: 20_000,
      pollIntervalMilliseconds: 250,
      fetch: request,
      delay: async (_milliseconds, signal) => {
        markDelayStarted?.();
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      },
    });
    const controller = new AbortController();
    const training = provider.trainIdentity({
      bible,
      modelVersion: model,
      references,
      signal: controller.signal,
    });

    await delayStarted;
    controller.abort();

    await expect(training).rejects.toMatchObject({
      code: "CHARACTER_JOB_ABORTED",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("maps provider failures without exposing response bodies", async () => {
    const provider = createProvider(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("private stack trace", { status: 503 }),
      ),
    );
    await expect(
      provider.trainIdentity({ bible, modelVersion: model, references }),
    ).rejects.toMatchObject({ code: "CHARACTER_PROVIDER_UNAVAILABLE" });
  });

  it("propagates shutdown cancellation into the provider request", async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(
      async (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const training = createProvider(request).trainIdentity({
      bible,
      modelVersion: model,
      references,
      signal: controller.signal,
    });

    controller.abort();

    await expect(training).rejects.toMatchObject({
      code: "CHARACTER_JOB_ABORTED",
    });
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("bounds provider response bodies before parsing them", async () => {
    const provider = createProvider(
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("x".repeat(1024 * 1024 + 1), {
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(
      provider.trainIdentity({ bible, modelVersion: model, references }),
    ).rejects.toMatchObject({ code: "CHARACTER_PROVIDER_RESPONSE_INVALID" });
  });
});

function createProvider(request: typeof fetch) {
  return new HttpCharacterInferenceProvider({
    baseUrl: "https://inference.internal/",
    apiKey: "a-secure-test-key",
    timeoutMilliseconds: 10_000,
    fetch: request,
  });
}

function makeBible(): CharacterBible {
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    revision: 1,
    status: "approved",
    displayName: "Adam",
    identityDescription: "Stable identity",
    negativeConstraints: [],
    distinguishingFeatures: [],
    proportions: {
      headToBodyHeightRatio: 0.2,
      shoulderToBodyHeightRatio: 0.25,
      eyeSpacingToFaceWidthRatio: 0.22,
      notes: [],
    },
    palette: [],
    materials: [],
    createdByUserId: crypto.randomUUID(),
    approvedByUserId: crypto.randomUUID(),
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function makeModel(): CharacterIdentityModelVersion {
  return {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    version: 1,
    status: "ready",
    providerKey: "private-http",
    providerModelReference: "private:model-1",
    baseModelReference: "candidate",
    datasetFingerprint: "c".repeat(64),
    trainingConfiguration: {},
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeReference(): CharacterReferenceAsset {
  return {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    role: "identity-primary",
    canonicalView: "frontal",
    rightsClassification: "owned-by-user",
    rightsAttestedByUserId: crypto.randomUUID(),
    rightsAttestedAt: now,
    artifact: {
      objectKey: `projects/${projectId}/character-rig/references/primary.png`,
      contentType: "image/png",
      sizeBytes: 1,
      sha256: "d".repeat(64),
      createdAt: now,
      retentionExpiresAt: null,
    },
    width: 100,
    height: 100,
    createdAt: now,
  };
}
