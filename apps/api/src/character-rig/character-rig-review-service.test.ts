import type {
  CharacterArtifactReference,
  CharacterBible,
  CharacterRigVersion,
} from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";
import { CharacterRigReviewService } from "./character-rig-review-service.js";

const now = "2026-08-12T12:00:00.000Z";

describe("CharacterRigReviewService", () => {
  it("approves a compiled rig once and replays the same operation", async () => {
    const setup = await fixture();
    const input = {
      projectId: setup.projectId,
      rigVersionId: setup.rig.id,
      decision: "approved" as const,
      reason: "The PSD hierarchy and manifest match the approved parts.",
      operationId: "rig-review-operation-001",
      actorUserId: setup.userId,
      reviewedAt: now,
    };

    const first = await setup.service.review(input);
    const replay = await setup.service.review(input);

    expect(first).toMatchObject({ replayed: false, rig: { status: "approved" } });
    expect(first.rig.approvedByUserId).toBe(setup.userId);
    expect(replay).toMatchObject({ replayed: true, rig: { status: "approved" } });
    expect(replay.review.id).toBe(first.review.id);
  });

  it("rejects idempotency drift and rigs without both artifacts", async () => {
    const setup = await fixture();
    const operation = {
      projectId: setup.projectId,
      rigVersionId: setup.rig.id,
      decision: "rejected" as const,
      reason: "The manifest hierarchy needs correction.",
      operationId: "rig-review-operation-002",
      actorUserId: setup.userId,
      reviewedAt: now,
    };
    await setup.service.review(operation);
    await expect(
      setup.service.review({ ...operation, decision: "approved" }),
    ).rejects.toMatchObject({
      code: "CHARACTER_RIG_REVIEW_IDEMPOTENCY_CONFLICT",
    });

    const second = await fixture({ manifestArtifact: null });
    await expect(
      second.service.review({
        projectId: second.projectId,
        rigVersionId: second.rig.id,
        decision: "approved",
        reason: "The compiled hierarchy is ready for animation.",
        operationId: "rig-review-operation-003",
        actorUserId: second.userId,
        reviewedAt: now,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_RIG_NOT_REVIEWABLE" });
  });
});

async function fixture(overrides: Partial<CharacterRigVersion> = {}) {
  const projectId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const repository = new InMemoryCharacterRigRepository();
  const bible: CharacterBible = {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    revision: 1,
    status: "approved",
    displayName: "Rig review fixture",
    identityDescription: "A stable identity used to verify compiled rig review.",
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
  await repository.saveBibleIfRevision(bible, null);
  const storage = new InMemoryObjectStorage();
  const artifact = async (
    name: string,
    contentType: CharacterArtifactReference["contentType"],
  ): Promise<CharacterArtifactReference> => {
    const body = Buffer.from(name);
    const metadata = await storage.put({
      key: `rig/${name}`,
      contentType,
      sizeBytes: body.byteLength,
      body,
    });
    return {
      objectKey: metadata.key,
      contentType,
      sizeBytes: metadata.sizeBytes,
      sha256: metadata.sha256,
      createdAt: now,
      retentionExpiresAt: null,
    };
  };
  const rig: CharacterRigVersion = {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    version: 1,
    status: "needs-review",
    sourceFingerprint: "b".repeat(64),
    canvas: { width: 1024, height: 1024 },
    nodes: [],
    psdArtifact: await artifact("character.psd", "image/vnd.adobe.photoshop"),
    manifestArtifact: await artifact("manifest.json", "application/json"),
    approvedByUserId: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  await repository.saveRigVersion(rig);
  return {
    projectId,
    userId,
    rig,
    service: new CharacterRigReviewService(repository, storage),
  };
}
