import { describe, expect, it } from "vitest";
import { createAppTestHarness, registerCreator } from "./app-test-helpers.js";
import { loadConfig } from "./config.js";
import { InMemoryCharacterJobRepository } from "./character-rig/character-job-repository.js";
import { InMemoryCharacterRigRepository } from "./character-rig/character-rig-repository.js";
import { executeClaimedCharacterJob } from "./character-rig/character-job-executor.js";
import { InMemoryCharacterJobResultCommitter } from "./character-rig/character-job-result-committer.js";
import { FakeCharacterInferenceProvider } from "./character-rig/fake-character-inference-provider.js";
import { InMemoryObjectStorage } from "./storage/object-storage.js";

const harness = createAppTestHarness();

describe("character-rig HTTP foundation", () => {
  it("fails closed while the runtime capability is disabled", async () => {
    const app = await harness.build(loadConfig({ NODE_ENV: "test" }));
    const cookie = await registerCreator(app);
    const projectId = await createImageProject(app, cookie);
    const response = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/character-rig`,
      headers: { cookie },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("CHARACTER_RIG_DISABLED");
  });

  it("rejects every Character Rig operation for PDF projects", async () => {
    const app = await harness.build(
      loadConfig({ NODE_ENV: "test", CHARACTER_RIG_ENABLED: "true" }),
    );
    const cookie = await registerCreator(app);
    const projectId = await createProject(app, cookie, "book");
    const attemptId = crypto.randomUUID();
    const operations = [
      ["GET", `/v1/projects/${projectId}/character-rig`],
      ["PUT", `/v1/projects/${projectId}/character-rig/bible`],
      ["POST", `/v1/projects/${projectId}/character-rig/bible/approve`],
      ["POST", `/v1/projects/${projectId}/character-rig/references/current-source`],
      ["POST", `/v1/projects/${projectId}/character-rig/identity-model`],
      ["POST", `/v1/projects/${projectId}/character-rig/generations`],
      ["POST", `/v1/projects/${projectId}/character-rig/generations/${attemptId}/reviews`],
      ["GET", `/v1/projects/${projectId}/character-rig/generations/${attemptId}/artifact`],
      ["POST", `/v1/projects/${projectId}/character-rig/compile`],
    ] as const;

    for (const [method, url] of operations) {
      const response = await app.inject({ method, url, headers: { cookie } });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
      expect(response.json().error.code).toBe("PROJECT_NOT_FOUND");
    }
  });

  it("saves, reads, and approves a versioned Character Bible", async () => {
    const app = await harness.build(
      loadConfig({ NODE_ENV: "test", CHARACTER_RIG_ENABLED: "true" }),
    );
    const cookie = await registerCreator(app);
    const projectId = await createImageProject(app, cookie);
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/character-rig/bible`,
      headers: { cookie },
      payload: completeBibleDraft(),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data).toMatchObject({ revision: 1, status: "draft" });

    const state = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/character-rig`,
      headers: { cookie },
    });
    expect(state.json().data.bible.id).toBe(saved.json().data.id);
    expect(state.json().data.references).toEqual([]);

    const approved = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/character-rig/bible/approve`,
      headers: { cookie },
      payload: {
        bibleId: saved.json().data.id,
        expectedRevision: 1,
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data).toMatchObject({ revision: 2, status: "approved" });

    const immutable = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/character-rig/bible`,
      headers: { cookie },
      payload: {
        ...completeBibleDraft(),
        bibleId: saved.json().data.id,
        expectedRevision: 2,
      },
    });
    expect(immutable.statusCode).toBe(422);
    expect(immutable.json().error.code).toBe("CHARACTER_BIBLE_IMMUTABLE");
  });

  it("queues, executes, serves, and reviews an identity-locked generation", async () => {
    const requestTime = new Date("2026-08-11T11:59:00.000Z");
    const characterRigs = new InMemoryCharacterRigRepository();
    const characterJobs = new InMemoryCharacterJobRepository();
    const objectStorage = new InMemoryObjectStorage();
    const app = await harness.build(
      loadConfig({ NODE_ENV: "test", CHARACTER_RIG_ENABLED: "true" }),
      {
        characterRigs,
        characterJobs,
        objectStorage,
        now: () => new Date(requestTime),
      },
    );
    const cookie = await registerCreator(app);
    const projectId = await createImageProject(app, cookie);
    const saved = await app.inject({
      method: "PUT",
      url: `/v1/projects/${projectId}/character-rig/bible`,
      headers: { cookie },
      payload: completeBibleDraft(),
    });
    const bibleId = saved.json().data.id as string;
    await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/character-rig/bible/approve`,
      headers: { cookie },
      payload: { bibleId, expectedRevision: 1 },
    });
    await characterRigs.addReference(reference(projectId, bibleId, "identity-primary", "frontal"));
    await characterRigs.addReference(reference(projectId, bibleId, "canonical-view", "left-quarter"));

    const bootstrap = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/character-rig/identity-model`,
      headers: { cookie, "x-idempotency-key": "identity-bootstrap-001" },
      payload: { bibleId },
    });
    expect(bootstrap.statusCode).toBe(202);
    const modelId = bootstrap.json().data.modelVersion.id as string;
    const trainJob = await characterJobs.claimNext(
      "test-character-worker",
      "2026-08-11T12:00:00.000Z",
      "2026-08-11T12:10:00.000Z",
    );
    expect(trainJob).not.toBeNull();
    if (!trainJob) throw new Error("Expected the identity training job to be claimable.");
    await executeClaimedCharacterJob(
      {
        jobs: characterJobs,
        characterRigs,
        resultCommitter: new InMemoryCharacterJobResultCommitter(
          characterJobs,
          characterRigs,
        ),
        provider: new FakeCharacterInferenceProvider(),
        storage: objectStorage,
        workerId: "test-character-worker",
        leaseMilliseconds: 600_000,
        now: () => new Date("2026-08-11T12:01:00.000Z"),
      },
      trainJob,
    );

    const generation = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/character-rig/generations`,
      headers: { cookie, "x-idempotency-key": "generate-left-profile-001" },
      payload: {
        bibleId,
        identityModelVersionId: modelId,
        target: { kind: "canonical-view", view: "left-profile" },
        controls: {
          seed: 42,
          poseReferenceId: null,
          depthReferenceId: null,
          maskReferenceId: null,
          parameters: { angleDegrees: -90 },
        },
      },
    });
    expect(generation.statusCode).toBe(202);
    const attemptId = generation.json().data.attempt.id as string;
    const generationJob = await characterJobs.claimNext(
      "test-character-worker",
      "2026-08-11T12:02:00.000Z",
      "2026-08-11T12:12:00.000Z",
    );
    expect(generationJob).not.toBeNull();
    if (!generationJob) {
      throw new Error("Expected the generation job to be claimable.");
    }
    await executeClaimedCharacterJob(
      {
        jobs: characterJobs,
        characterRigs,
        resultCommitter: new InMemoryCharacterJobResultCommitter(
          characterJobs,
          characterRigs,
        ),
        provider: new FakeCharacterInferenceProvider(),
        storage: objectStorage,
        workerId: "test-character-worker",
        leaseMilliseconds: 600_000,
        now: () => new Date("2026-08-11T12:03:00.000Z"),
      },
      generationJob,
    );

    const artifact = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/character-rig/generations/${attemptId}/artifact`,
      headers: { cookie },
    });
    expect(artifact.statusCode).toBe(200);
    expect(artifact.headers["content-type"]).toContain("image/png");
    const storedAttempt = await characterRigs.findGenerationAttempt(
      projectId,
      attemptId,
    );
    if (!storedAttempt?.outputArtifact) {
      throw new Error("Expected the generated artifact metadata.");
    }
    await objectStorage.put({
      key: storedAttempt.outputArtifact.objectKey,
      contentType: storedAttempt.outputArtifact.contentType,
      sizeBytes: storedAttempt.outputArtifact.sizeBytes,
      body: Buffer.alloc(storedAttempt.outputArtifact.sizeBytes, 0x7f),
    });
    const tampered = await app.inject({
      method: "GET",
      url: `/v1/projects/${projectId}/character-rig/generations/${attemptId}/artifact`,
      headers: { cookie },
    });
    expect(tampered.statusCode).toBe(409);
    expect(tampered.json().error.code).toBe(
      "CHARACTER_ARTIFACT_INTEGRITY_FAILED",
    );
    const review = await app.inject({
      method: "POST",
      url: `/v1/projects/${projectId}/character-rig/generations/${attemptId}/reviews`,
      headers: { cookie, "x-idempotency-key": "review-001" },
      payload: {
        decision: "approved",
        reason: "Identity and proportions match the approved references.",
      },
    });
    expect(review.statusCode).toBe(201);
    expect(review.json().data.attempt.status).toBe("approved");
  });
});

function reference(
  projectId: string,
  bibleId: string,
  role: "identity-primary" | "canonical-view",
  canonicalView: "frontal" | "left-quarter",
) {
  const id = crypto.randomUUID();
  return {
    id,
    projectId,
    bibleId,
    role,
    canonicalView,
    rightsClassification: "owned-by-user" as const,
    rightsAttestedByUserId: crypto.randomUUID(),
    rightsAttestedAt: "2026-08-11T11:00:00.000Z",
    artifact: {
      objectKey: `projects/${projectId}/character-rig/references/${id}.png`,
      contentType: "image/png" as const,
      sizeBytes: 1,
      sha256: id.replaceAll("-", "").padEnd(64, "a"),
      createdAt: "2026-08-11T11:00:00.000Z",
      retentionExpiresAt: null,
    },
    width: 100,
    height: 100,
    createdAt: "2026-08-11T11:00:00.000Z",
  };
}

async function createImageProject(app: Awaited<ReturnType<typeof harness.build>>, cookie: string) {
  return createProject(app, cookie, "image");
}

async function createProject(
  app: Awaited<ReturnType<typeof harness.build>>,
  cookie: string,
  kind: "image" | "book",
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/projects",
    headers: { cookie },
    payload: { name: "Character test", kind },
  });
  expect(response.statusCode).toBe(201);
  return response.json().data.id as string;
}

function completeBibleDraft() {
  return {
    bibleId: null,
    expectedRevision: null,
    displayName: "Adam",
    identityDescription: "A stable identity description for the character under review.",
    negativeConstraints: ["Do not change facial geometry"],
    distinguishingFeatures: ["Round glasses"],
    proportions: {
      headToBodyHeightRatio: 0.2,
      shoulderToBodyHeightRatio: 0.25,
      eyeSpacingToFaceWidthRatio: 0.22,
      notes: [],
    },
    palette: [
      {
        id: crypto.randomUUID(),
        label: "Outline",
        role: "outline",
        color: "#111827",
      },
    ],
    materials: [],
  };
}
