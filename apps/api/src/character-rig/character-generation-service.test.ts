import type {
  CharacterBible,
  CharacterIdentityModelVersion,
  CharacterReferenceAsset,
} from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { CharacterGenerationService } from "./character-generation-service.js";
import { InMemoryCharacterJobRepository } from "./character-job-repository.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";

const now = "2026-08-11T00:00:00.000Z";
const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();

describe("CharacterGenerationService", () => {
  it("queues a deterministic generation and safely replays the operation", async () => {
    const { service, rigs, bible, model } = await fixture();
    const input = generationInput(bible, model);

    const first = await service.queue(input);
    const replay = await service.queue(input);

    expect(first.replayed).toBe(false);
    expect(replay.replayed).toBe(true);
    expect(replay.attempt.id).toBe(first.attempt.id);
    expect(replay.job.id).toBe(first.job.id);
    expect(await rigs.listGenerationAttempts(projectId, bible.id)).toHaveLength(1);
  });

  it("rejects reused idempotency keys and masked repair without a mask", async () => {
    const { service, bible, model } = await fixture();
    const input = generationInput(bible, model);
    await service.queue(input);
    await expect(
      service.queue({
        ...input,
        target: { kind: "canonical-view", view: "right-profile" },
      }),
    ).rejects.toMatchObject({
      code: "CHARACTER_GENERATION_IDEMPOTENCY_CONFLICT",
    });
    await expect(
      service.queue({
        ...input,
        idempotencyKey: "masked-repair-operation",
        target: { kind: "masked-repair", view: "frontal", partName: "mouth" },
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_REPAIR_MASK_REQUIRED" });
  });

  it("records a human approval only after the automated gate", async () => {
    const { service, rigs, bible, model } = await fixture();
    const queued = await service.queue(generationInput(bible, model));
    await rigs.saveGenerationAttempt({
      ...queued.attempt,
      status: "needs-review",
      outputArtifact: {
        objectKey: `projects/${projectId}/character-rig/generations/result.png`,
        contentType: "image/png",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        createdAt: now,
        retentionExpiresAt: null,
      },
      qualityReport: {
        thresholdsSchemaVersion: 1,
        landmarkMeanHeadWidthRatio: 0.01,
        landmarkCriticalPointHeadWidthRatio: 0.01,
        proportionDeviationRatio: 0.01,
        paletteMeanDeltaE00: 1,
        heroMaterialDeltaE00: 1,
        outsideMaskChangedPixelRatio: 0,
        severeDefects: [],
        passedAutomatedGate: true,
      },
    });

    const approved = await service.review({
      projectId,
      generationAttemptId: queued.attempt.id,
      decision: "approved",
      reason: "Identity, silhouette, and proportions match the reference pack.",
      operationId: "review-operation-001",
      actorUserId: userId,
      reviewedAt: now,
    });

    expect(approved.attempt.status).toBe("approved");
    expect((await service.review({
      projectId,
      generationAttemptId: queued.attempt.id,
      decision: "approved",
      reason: "Identity, silhouette, and proportions match the reference pack.",
      operationId: "review-operation-001",
      actorUserId: userId,
      reviewedAt: now,
    })).replayed).toBe(true);
  });

  it("reloads the reviewed attempt when an idempotent review is observed", async () => {
    const { rigs, bible, model } = await fixture();
    const setupService = new CharacterGenerationService(
      rigs,
      new InMemoryCharacterJobRepository(),
    );
    const queued = await setupService.queue(generationInput(bible, model));
    const reviewable = reviewableAttempt(queued.attempt);
    await rigs.saveGenerationAttempt(reviewable);
    const review = {
      id: crypto.randomUUID(),
      projectId,
      generationAttemptId: queued.attempt.id,
      decision: "approved" as const,
      reason: "Identity and proportions match the approved reference pack.",
      reviewerUserId: userId,
      operationId: "review-reload-operation",
      createdAt: now,
    };
    await rigs.commitGenerationReview(review, {
      ...reviewable,
      status: "approved",
    });

    let firstRead = true;
    const repository = new Proxy(rigs, {
      get(target, property, receiver) {
        if (property === "findGenerationAttempt") {
          return async () => {
            if (firstRead) {
              firstRead = false;
              return structuredClone(reviewable);
            }
            return target.findGenerationAttempt(projectId, queued.attempt.id);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as CharacterRigRepository;
    const result = await new CharacterGenerationService(
      repository,
      new InMemoryCharacterJobRepository(),
    ).review({
      projectId,
      generationAttemptId: queued.attempt.id,
      decision: "approved",
      reason: review.reason,
      operationId: review.operationId,
      actorUserId: userId,
      reviewedAt: now,
    });

    expect(result.replayed).toBe(true);
    expect(result.attempt.status).toBe("approved");
  });
});

function reviewableAttempt(
  attempt: Awaited<ReturnType<CharacterGenerationService["queue"]>>["attempt"],
) {
  return {
    ...attempt,
    status: "needs-review" as const,
    outputArtifact: {
      objectKey: `projects/${projectId}/character-rig/generations/result.png`,
      contentType: "image/png" as const,
      sizeBytes: 1,
      sha256: "a".repeat(64),
      createdAt: now,
      retentionExpiresAt: null,
    },
    qualityReport: {
      thresholdsSchemaVersion: 1 as const,
      landmarkMeanHeadWidthRatio: 0.01,
      landmarkCriticalPointHeadWidthRatio: 0.01,
      proportionDeviationRatio: 0.01,
      paletteMeanDeltaE00: 1,
      heroMaterialDeltaE00: 1,
      outsideMaskChangedPixelRatio: 0,
      severeDefects: [],
      passedAutomatedGate: true,
    },
  };
}

async function fixture() {
  const rigs = new InMemoryCharacterRigRepository();
  const jobs = new InMemoryCharacterJobRepository();
  const service = new CharacterGenerationService(rigs, jobs);
  const bible: CharacterBible = {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    revision: 2,
    status: "approved",
    displayName: "Adam",
    identityDescription: "Stable character identity for controlled generation.",
    negativeConstraints: ["Never change facial geometry"],
    distinguishingFeatures: ["Rounded face and narrow dark brows"],
    proportions: {
      headToBodyHeightRatio: 0.2,
      shoulderToBodyHeightRatio: 0.25,
      eyeSpacingToFaceWidthRatio: 0.22,
      notes: [],
    },
    palette: [{
      id: crypto.randomUUID(),
      label: "Outline",
      role: "outline",
      color: "#111827",
    }],
    materials: [],
    createdByUserId: userId,
    approvedByUserId: userId,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await rigs.saveBibleIfRevision({ ...bible, revision: 1, status: "draft", approvedByUserId: null, approvedAt: null }, null);
  await rigs.saveBibleIfRevision(bible, 1);
  const reference = (role: CharacterReferenceAsset["role"]): CharacterReferenceAsset => ({
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    role,
    canonicalView: role === "identity-primary" ? "frontal" : "left-quarter",
    rightsClassification: "owned-by-user",
    rightsAttestedByUserId: userId,
    rightsAttestedAt: now,
    artifact: {
      objectKey: `projects/${projectId}/character-rig/references/${crypto.randomUUID()}.png`,
      contentType: "image/png",
      sizeBytes: 10,
      sha256: crypto.randomUUID().replaceAll("-", "").padEnd(64, "a"),
      createdAt: now,
      retentionExpiresAt: null,
    },
    width: 100,
    height: 100,
    createdAt: now,
  });
  await rigs.addReference(reference("identity-primary"));
  await rigs.addReference(reference("canonical-view"));
  const model: CharacterIdentityModelVersion = {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    version: 1,
    status: "ready",
    providerKey: "fake",
    providerModelReference: "fake:model",
    baseModelReference: "identity-eval-v1",
    datasetFingerprint: "a".repeat(64),
    trainingConfiguration: {},
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
  await rigs.saveIdentityModelVersion(model);
  return { service, rigs, bible, model };
}

function generationInput(
  bible: CharacterBible,
  model: CharacterIdentityModelVersion,
) {
  return {
    projectId,
    bibleId: bible.id,
    identityModelVersionId: model.id,
    target: { kind: "canonical-view" as const, view: "left-profile" as const },
    controls: {
      canvas: { width: 1024, height: 1024 },
      seed: 42,
      poseReferenceId: null,
      depthReferenceId: null,
      maskReferenceId: null,
      parameters: { angleDegrees: -90 },
    },
    idempotencyKey: "generation-operation-001",
    actorUserId: userId,
    requestedAt: now,
  };
}
