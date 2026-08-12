import type {
  CharacterBible,
  CharacterGenerationAttempt,
  CharacterIdentityModelVersion,
  CharacterReferenceAsset,
} from "@motionprep/contracts";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import { describe, expect, it } from "vitest";
import {
  InMemoryCharacterJobRepository,
} from "./character-job-repository.js";
import { executeClaimedCharacterJob } from "./character-job-executor.js";
import { CharacterJobService } from "./character-job-service.js";
import { InMemoryCharacterJobResultCommitter } from "./character-job-result-committer.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";
import { FakeCharacterInferenceProvider } from "./fake-character-inference-provider.js";
import { CharacterProviderError } from "./character-inference-provider.js";

const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();
const initialTime = new Date("2026-08-11T00:00:00.000Z");

describe("character job runtime", () => {
  it("queues idempotently and rejects request-hash reuse", async () => {
    const jobs = new InMemoryCharacterJobRepository();
    const service = new CharacterJobService(jobs);
    const input = {
      projectId,
      type: "train-identity" as const,
      operationKey: "train-operation-1",
      requestHash: "a".repeat(64),
      payload: { modelVersionId: crypto.randomUUID() },
      now: initialTime.toISOString(),
    };
    const first = await service.enqueue(input);
    expect(await service.enqueue(input)).toEqual(first);
    await expect(
      service.enqueue({ ...input, requestHash: "b".repeat(64) }),
    ).rejects.toMatchObject({ code: "CHARACTER_JOB_IDEMPOTENCY_CONFLICT" });
  });

  it("claims with a lease and recovers only after expiry", async () => {
    const jobs = new InMemoryCharacterJobRepository();
    const service = new CharacterJobService(jobs);
    await service.enqueue({
      projectId,
      type: "train-identity",
      operationKey: "lease-operation-1",
      requestHash: "c".repeat(64),
      payload: { modelVersionId: crypto.randomUUID() },
      now: initialTime.toISOString(),
    });
    const first = await jobs.claimNext(
      "worker-a",
      initialTime.toISOString(),
      new Date(initialTime.getTime() + 60_000).toISOString(),
    );
    expect(first?.attempt).toBe(1);
    expect(
      await jobs.claimNext(
        "worker-b",
        new Date(initialTime.getTime() + 30_000).toISOString(),
        new Date(initialTime.getTime() + 90_000).toISOString(),
      ),
    ).toBeNull();
    expect(
      (
        await jobs.claimNext(
          "worker-b",
          new Date(initialTime.getTime() + 60_001).toISOString(),
          new Date(initialTime.getTime() + 120_001).toISOString(),
        )
      )?.leaseOwner,
    ).toBe("worker-b");
  });

  it("releases a shutdown claim for immediate retry without consuming an attempt", async () => {
    const jobs = new InMemoryCharacterJobRepository();
    await new CharacterJobService(jobs).enqueue({
      projectId,
      type: "train-identity",
      operationKey: "shutdown-release-operation",
      requestHash: "9".repeat(64),
      payload: { modelVersionId: crypto.randomUUID() },
      now: initialTime.toISOString(),
    });
    const first = await claim(jobs);

    expect(
      await jobs.releaseClaim(
        first.id,
        "worker-a",
        new Date(initialTime.getTime() + 1_000).toISOString(),
      ),
    ).toBe(true);
    const recovered = await jobs.claimNext(
      "worker-b",
      new Date(initialTime.getTime() + 1_001).toISOString(),
      new Date(initialTime.getTime() + 61_001).toISOString(),
    );

    expect(recovered).toMatchObject({ leaseOwner: "worker-b", attempt: 1 });
  });

  it("trains an identity version before generation", async () => {
    const setup = await createReadyContext();
    const service = new CharacterJobService(setup.jobs);
    await service.enqueue({
      projectId,
      type: "train-identity",
      operationKey: "train-operation-2",
      requestHash: "d".repeat(64),
      payload: { modelVersionId: setup.model.id },
      now: initialTime.toISOString(),
    });
    const claimed = await claim(setup.jobs);
    const result = await executeClaimedCharacterJob(
      { ...setup.context, now: advancingClock() },
      claimed,
    );
    expect(result?.status).toBe("succeeded");
    expect(
      (await setup.rigs.findIdentityModelVersion(projectId, setup.model.id))
        ?.providerModelReference,
    ).toMatch(/^fake:/u);
  });

  it("stores generated pixels and requires human review after automated success", async () => {
    const setup = await createReadyContext("ready");
    const attempt = makeAttempt(setup.bible, setup.model);
    await setup.rigs.saveGenerationAttempt(attempt);
    const job = await enqueueAndClaimGeneration(setup.jobs, attempt);
    await executeClaimedCharacterJob(
      { ...setup.context, now: advancingClock() },
      job,
    );
    const storedAttempt = await setup.rigs.findGenerationAttempt(projectId, attempt.id);
    expect(storedAttempt?.status).toBe("needs-review");
    expect(storedAttempt?.qualityReport?.passedAutomatedGate).toBe(true);
    expect(await setup.storage.inspect(storedAttempt?.outputArtifact?.objectKey ?? "")).not.toBeNull();
  });

  it("rejects drifted output instead of promoting it", async () => {
    const setup = await createReadyContext("ready", false);
    const attempt = makeAttempt(setup.bible, setup.model);
    await setup.rigs.saveGenerationAttempt(attempt);
    const job = await enqueueAndClaimGeneration(setup.jobs, attempt);
    await executeClaimedCharacterJob(
      { ...setup.context, now: advancingClock() },
      job,
    );
    expect(
      await setup.rigs.findGenerationAttempt(projectId, attempt.id),
    ).toMatchObject({
      status: "rejected",
      failureCode: "CHARACTER_QUALITY_GATE_FAILED",
    });
  });

  it("removes a generated artifact when the fenced result commit is rejected", async () => {
    const setup = await createReadyContext("ready");
    const attempt = makeAttempt(setup.bible, setup.model);
    await setup.rigs.saveGenerationAttempt(attempt);
    const job = await enqueueAndClaimGeneration(setup.jobs, attempt);

    const result = await executeClaimedCharacterJob(
      {
        ...setup.context,
        resultCommitter: { async commit() { return false; } },
        now: advancingClock(),
      },
      job,
    );

    expect(result).toBeNull();
    expect(
      await setup.storage.inspect(
        `projects/${projectId}/character-rig/generations/${attempt.id}.png`,
      ),
    ).toBeNull();
  });

  it("fails permanent provider responses once but retries transient outages", async () => {
    for (const [code, expectedStatus] of [
      ["CHARACTER_PROVIDER_RESPONSE_INVALID", "failed"],
      ["CHARACTER_PROVIDER_UNAVAILABLE", "queued"],
    ] as const) {
      const setup = await createReadyContext();
      await new CharacterJobService(setup.jobs).enqueue({
        projectId,
        type: "train-identity",
        operationKey: `provider-taxonomy-${code}`,
        requestHash: code === "CHARACTER_PROVIDER_UNAVAILABLE" ? "e".repeat(64) : "f".repeat(64),
        payload: { modelVersionId: setup.model.id },
        now: initialTime.toISOString(),
      });
      const claimed = await claim(setup.jobs);
      const settled = await executeClaimedCharacterJob(
        {
          ...setup.context,
          provider: {
            key: "failing-provider",
            async trainIdentity() {
              throw new CharacterProviderError(code);
            },
            async generate() {
              throw new CharacterProviderError(code);
            },
          },
          now: advancingClock(),
        },
        claimed,
      );
      expect(settled).toMatchObject({ status: expectedStatus, errorCode: code });
    }
  });

  it("cancels an in-flight provider request and requeues it during shutdown", async () => {
    const setup = await createReadyContext();
    await new CharacterJobService(setup.jobs).enqueue({
      projectId,
      type: "train-identity",
      operationKey: "abort-provider-operation",
      requestHash: "8".repeat(64),
      payload: { modelVersionId: setup.model.id },
      now: initialTime.toISOString(),
    });
    const claimed = await claim(setup.jobs);
    const controller = new AbortController();
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const execution = executeClaimedCharacterJob(
      {
        ...setup.context,
        signal: controller.signal,
        provider: {
          key: "abort-aware-provider",
          async trainIdentity(input) {
            providerStarted();
            return new Promise((_resolve, reject) => {
              input.signal?.addEventListener(
                "abort",
                () => reject(new CharacterProviderError("CHARACTER_JOB_ABORTED")),
                { once: true },
              );
            });
          },
          async generate() {
            throw new Error("Generation was not expected.");
          },
        },
        now: advancingClock(),
      },
      claimed,
    );
    await started;
    controller.abort();

    await expect(execution).resolves.toMatchObject({
      status: "queued",
      attempt: 0,
      leaseOwner: null,
    });
    await expect(
      setup.jobs.claimNext(
        "worker-b",
        new Date(initialTime.getTime() + 1_000).toISOString(),
        new Date(initialTime.getTime() + 61_000).toISOString(),
      ),
    ).resolves.toMatchObject({ leaseOwner: "worker-b", attempt: 1 });
  });
});

async function createReadyContext(
  modelStatus: CharacterIdentityModelVersion["status"] = "draft",
  automatedGatePasses = true,
) {
  const jobs = new InMemoryCharacterJobRepository();
  const rigs = new InMemoryCharacterRigRepository();
  const storage = new InMemoryObjectStorage();
  const bible = makeBible();
  await rigs.saveBibleIfRevision(bible, null);
  const reference = makeReference(bible);
  await rigs.addReference(reference);
  const model = makeModel(bible, modelStatus);
  await rigs.saveIdentityModelVersion(model);
  return {
    jobs,
    rigs,
    storage,
    bible,
    model,
    context: {
      jobs,
      characterRigs: rigs,
      resultCommitter: new InMemoryCharacterJobResultCommitter(jobs, rigs),
      provider: new FakeCharacterInferenceProvider(automatedGatePasses),
      storage,
      workerId: "worker-a",
      leaseMilliseconds: 60_000,
    },
  };
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
    createdByUserId: userId,
    approvedByUserId: userId,
    approvedAt: initialTime.toISOString(),
    createdAt: initialTime.toISOString(),
    updatedAt: initialTime.toISOString(),
  };
}

function makeReference(bible: CharacterBible): CharacterReferenceAsset {
  return {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    role: "identity-primary",
    canonicalView: "frontal",
    rightsClassification: "owned-by-user",
    rightsAttestedByUserId: userId,
    rightsAttestedAt: initialTime.toISOString(),
    artifact: {
      objectKey: "references/primary.png",
      contentType: "image/png",
      sizeBytes: 1,
      sha256: "e".repeat(64),
      createdAt: initialTime.toISOString(),
      retentionExpiresAt: null,
    },
    width: 100,
    height: 100,
    createdAt: initialTime.toISOString(),
  };
}

function makeModel(
  bible: CharacterBible,
  status: CharacterIdentityModelVersion["status"],
): CharacterIdentityModelVersion {
  return {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    version: 1,
    status,
    providerKey: "fake",
    providerModelReference: status === "ready" ? "fake:ready" : null,
    baseModelReference: "evaluation-candidate",
    datasetFingerprint: "f".repeat(64),
    trainingConfiguration: {},
    failureCode: null,
    createdAt: initialTime.toISOString(),
    updatedAt: initialTime.toISOString(),
  };
}

function makeAttempt(
  bible: CharacterBible,
  model: CharacterIdentityModelVersion,
): CharacterGenerationAttempt {
  return {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    identityModelVersionId: model.id,
    target: { kind: "canonical-view", view: "left-quarter" },
    status: "queued",
    controls: {
      canvas: { width: 1024, height: 1024 },
      seed: 9,
      poseReferenceId: null,
      depthReferenceId: null,
      maskReferenceId: null,
      parameters: {},
    },
    requestHash: "1".repeat(64),
    idempotencyKey: `generation-${crypto.randomUUID()}`,
    outputArtifact: null,
    outputGeometry: null,
    qualityReport: null,
    failureCode: null,
    createdByUserId: userId,
    createdAt: initialTime.toISOString(),
    updatedAt: initialTime.toISOString(),
  };
}

async function enqueueAndClaimGeneration(
  jobs: InMemoryCharacterJobRepository,
  attempt: CharacterGenerationAttempt,
) {
  await new CharacterJobService(jobs).enqueue({
    projectId,
    type: "generate-view",
    operationKey: `job-${attempt.id}`,
    requestHash: attempt.requestHash,
    payload: { generationAttemptId: attempt.id },
    now: initialTime.toISOString(),
  });
  return claim(jobs);
}

async function claim(jobs: InMemoryCharacterJobRepository) {
  const job = await jobs.claimNext(
    "worker-a",
    initialTime.toISOString(),
    new Date(initialTime.getTime() + 60_000).toISOString(),
  );
  if (!job) throw new Error("Expected a claimed character job.");
  return job;
}

function advancingClock() {
  let tick = 0;
  return () => new Date(initialTime.getTime() + ++tick * 100);
}
