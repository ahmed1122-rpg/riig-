import type {
  CharacterBible,
  CharacterGenerationAttempt,
  CharacterIdentityModelVersion,
  CharacterReferenceAsset,
  CharacterRigVersion,
} from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";

const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();
const now = "2026-08-11T00:00:00.000Z";

function makeBible(overrides: Partial<CharacterBible> = {}): CharacterBible {
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    revision: 1,
    status: "draft",
    displayName: "Adam",
    identityDescription: "A stable test identity",
    negativeConstraints: ["Do not change facial geometry"],
    distinguishingFeatures: ["Round glasses"],
    proportions: {
      headToBodyHeightRatio: 0.2,
      shoulderToBodyHeightRatio: 0.25,
      eyeSpacingToFaceWidthRatio: 0.22,
      notes: [],
    },
    palette: [],
    materials: [],
    createdByUserId: userId,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeModel(bible: CharacterBible): CharacterIdentityModelVersion {
  return {
    id: crypto.randomUUID(),
    projectId: bible.projectId,
    bibleId: bible.id,
    version: 1,
    status: "ready",
    providerKey: "fake",
    providerModelReference: "fake:model-1",
    baseModelReference: "evaluation-candidate",
    datasetFingerprint: "a".repeat(64),
    trainingConfiguration: { steps: 1 },
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeAttempt(
  bible: CharacterBible,
  model: CharacterIdentityModelVersion,
): CharacterGenerationAttempt {
  return {
    id: crypto.randomUUID(),
    projectId: bible.projectId,
    bibleId: bible.id,
    identityModelVersionId: model.id,
    target: { kind: "canonical-view", view: "frontal" },
    status: "needs-review",
    controls: {
      seed: 7,
      poseReferenceId: null,
      depthReferenceId: null,
      maskReferenceId: null,
      parameters: {},
    },
    requestHash: "b".repeat(64),
    idempotencyKey: "generation-operation-1",
    outputArtifact: null,
    qualityReport: null,
    failureCode: null,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  };
}

describe("InMemoryCharacterRigRepository", () => {
  it("enforces optimistic Bible revisions and project isolation", async () => {
    const repository = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    expect(await repository.saveBibleIfRevision(bible, null)).toBe(true);
    expect(await repository.saveBibleIfRevision(bible, null)).toBe(false);
    expect(await repository.findBible(crypto.randomUUID(), bible.id)).toBeNull();

    const updated = { ...bible, revision: 2, displayName: "Adam v2" };
    expect(await repository.saveBibleIfRevision(updated, 1)).toBe(true);
    expect((await repository.findLatestBible(projectId))?.displayName).toBe("Adam v2");
    expect(await repository.saveBibleIfRevision({ ...updated, revision: 4 }, 2)).toBe(false);

    const duplicateVersion = makeBible({ version: 1 });
    expect(await repository.saveBibleIfRevision(duplicateVersion, null)).toBe(false);
  });

  it("keeps references and model versions scoped to their Bible", async () => {
    const repository = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    await repository.saveBibleIfRevision(bible, null);
    const reference: CharacterReferenceAsset = {
      id: crypto.randomUUID(),
      projectId,
      bibleId: bible.id,
      role: "identity-primary",
      canonicalView: "frontal",
      rightsClassification: "owned-by-user",
      rightsAttestedByUserId: userId,
      rightsAttestedAt: now,
      artifact: {
        objectKey: "character/reference.png",
        contentType: "image/png",
        sizeBytes: 12,
        sha256: "c".repeat(64),
        createdAt: now,
        retentionExpiresAt: null,
      },
      width: 100,
      height: 100,
      createdAt: now,
    };
    expect(await repository.addReference(reference)).toBe(true);
    expect(await repository.addReference(reference)).toBe(false);
    expect(await repository.listReferences(projectId, bible.id)).toEqual([reference]);
    expect(
      await repository.addReference({ ...reference, id: crypto.randomUUID(), bibleId: crypto.randomUUID() }),
    ).toBe(false);

    const model = makeModel(bible);
    await repository.saveIdentityModelVersion(model);
    expect(await repository.findIdentityModelVersion(projectId, model.id)).toEqual(model);
    await expect(
      repository.saveIdentityModelVersion({ ...model, id: crypto.randomUUID(), bibleId: crypto.randomUUID() }),
    ).rejects.toThrow(/same project/u);
  });

  it("makes generation and review operations idempotent", async () => {
    const repository = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    await repository.saveBibleIfRevision(bible, null);
    const model = makeModel(bible);
    await repository.saveIdentityModelVersion(model);
    const attempt = makeAttempt(bible, model);
    await repository.saveGenerationAttempt(attempt);
    expect(
      await repository.findGenerationByIdempotencyKey(projectId, attempt.idempotencyKey),
    ).toEqual(attempt);
    expect(await repository.findGenerationAttempt(crypto.randomUUID(), attempt.id)).toBeNull();
    await expect(
      repository.saveGenerationAttempt({ ...attempt, id: crypto.randomUUID() }),
    ).rejects.toThrow(/idempotency/u);

    const review = {
      id: crypto.randomUUID(),
      projectId,
      generationAttemptId: attempt.id,
      decision: "approved" as const,
      reason: "Identity and proportions match.",
      reviewerUserId: userId,
      operationId: "review-operation-1",
      createdAt: now,
    };
    const approvedAttempt = { ...attempt, status: "approved" as const };
    expect(await repository.commitGenerationReview(review, approvedAttempt)).toBe(true);
    expect(
      await repository.commitGenerationReview(
        { ...review, id: crypto.randomUUID() },
        approvedAttempt,
      ),
    ).toBe(false);
    expect(await repository.findGenerationAttempt(projectId, attempt.id)).toEqual(
      approvedAttempt,
    );
    expect(await repository.listGenerationReviews(projectId, attempt.id)).toEqual([review]);
  });

  it("stores only rigs that belong to an existing project Bible", async () => {
    const repository = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    await repository.saveBibleIfRevision(bible, null);
    const rig: CharacterRigVersion = {
      schemaVersion: "1.0",
      id: crypto.randomUUID(),
      projectId,
      bibleId: bible.id,
      version: 1,
      status: "draft",
      nodes: [],
      psdArtifact: null,
      manifestArtifact: null,
      approvedByUserId: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await repository.saveRigVersion(rig);
    expect(await repository.findRigVersion(projectId, rig.id)).toEqual(rig);
    await expect(
      repository.saveRigVersion({ ...rig, id: crypto.randomUUID(), bibleId: crypto.randomUUID() }),
    ).rejects.toThrow(/same project/u);
  });
});
