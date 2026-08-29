import type {
  CharacterBible,
  CharacterReferenceAsset,
  CharacterRigReview,
  CharacterRigVersion,
} from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";

const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();
const now = "2026-08-11T00:00:00.000Z";

describe("InMemoryCharacterRigRepository", () => {
  it("enforces Bible revisions and project scoping", async () => {
    const repository = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    await expect(repository.saveBibleIfRevision(bible, null)).resolves.toBe(true);
    await expect(repository.saveBibleIfRevision(bible, null)).resolves.toBe(false);
    await expect(
      repository.saveBibleIfRevision(
        { ...bible, revision: 2, updatedAt: "2026-08-11T00:01:00.000Z" },
        1,
      ),
    ).resolves.toBe(true);
    await expect(repository.findBible(crypto.randomUUID(), bible.id)).resolves.toBeNull();
  });

  it("stores only references tied to an existing Bible", async () => {
    const repository = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    const reference = makeReference(bible);
    await expect(repository.addReference(reference)).resolves.toBe(false);
    await repository.saveBibleIfRevision(bible, null);
    await expect(repository.addReference(reference)).resolves.toBe(true);
    await expect(repository.addReference(reference)).resolves.toBe(false);
    await expect(repository.listReferences(projectId, bible.id)).resolves.toEqual([
      reference,
    ]);
  });

  it("stores source-preserving rigs and commits one review operation", async () => {
    const repository = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    const reference = makeReference(bible);
    const rig = makeRig(bible, reference);
    await repository.saveBibleIfRevision(bible, null);
    await repository.addReference(reference);
    await expect(repository.saveRigVersion(rig)).resolves.toBe(true);

    const review: CharacterRigReview = {
      id: crypto.randomUUID(),
      projectId,
      rigVersionId: rig.id,
      decision: "approved",
      reason: "Pixel identity and layer hierarchy verified.",
      reviewerUserId: userId,
      operationId: crypto.randomUUID(),
      createdAt: now,
    };
    await expect(
      repository.commitRigReview(review, {
        ...rig,
        status: "approved",
        approvedByUserId: userId,
        approvedAt: now,
      }),
    ).resolves.toBe(true);
    await expect(
      repository.commitRigReview(
        { ...review, id: crypto.randomUUID() },
        { ...rig, status: "approved" },
      ),
    ).resolves.toBe(false);
    await expect(
      repository.findRigReviewByOperation(userId, review.operationId),
    ).resolves.toEqual(review);
  });

  it("rejects a rig whose Bible belongs to another project", async () => {
    const repository = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    const reference = makeReference(bible);
    await repository.saveBibleIfRevision(bible, null);
    await expect(
      repository.saveRigVersion({
        ...makeRig(bible, reference),
        projectId: crypto.randomUUID(),
      }),
    ).rejects.toThrow(/same project/u);
  });
});

function makeBible(): CharacterBible {
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    revision: 1,
    status: "approved",
    displayName: "Source Character",
    identityDescription: "Metadata for the uploaded character.",
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
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function makeReference(bible: CharacterBible): CharacterReferenceAsset {
  return {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    sourceVersionId: crypto.randomUUID(),
    role: "identity-primary",
    canonicalView: "frontal",
    rightsClassification: "owned-by-user",
    rightsAttestedByUserId: userId,
    rightsAttestedAt: now,
    artifact: artifact("source.png"),
    width: 128,
    height: 128,
    createdAt: now,
  };
}

function makeRig(
  bible: CharacterBible,
  reference: CharacterReferenceAsset,
): CharacterRigVersion {
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    version: 1,
    status: "needs-review",
    pipeline: "source-preserving",
    failureCode: null,
    sourceFingerprint: "f".repeat(64),
    source: {
      sourceVersionId: reference.sourceVersionId,
      referenceId: reference.id,
      artifact: reference.artifact,
      layerDocumentRevision: 1,
      pixelIdentityRequired: true,
    },
    canvas: { width: 128, height: 128 },
    nodes: [],
    psdArtifact: null,
    manifestArtifact: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function artifact(objectKey: string) {
  return {
    objectKey,
    contentType: "image/png" as const,
    sizeBytes: 1,
    sha256: "a".repeat(64),
    createdAt: now,
    retentionExpiresAt: null,
  };
}
