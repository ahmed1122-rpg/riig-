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
    for (const drift of [
      { projectId: crypto.randomUUID() },
      { rigVersionId: crypto.randomUUID() },
      { reason: "A different review reason." },
    ]) {
      await expect(setup.service.review({ ...operation, ...drift })).rejects.toMatchObject({
        code: "CHARACTER_RIG_REVIEW_IDEMPOTENCY_CONFLICT",
      });
    }

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

  it("distinguishes missing, unreviewable, and corrupt rig artifacts", async () => {
    const missing = await fixture();
    await expect(missing.service.review({
      projectId: missing.projectId,
      rigVersionId: crypto.randomUUID(),
      decision: "approved",
      reason: "No such rig exists.",
      operationId: "rig-review-operation-missing",
      actorUserId: missing.userId,
      reviewedAt: now,
    })).rejects.toMatchObject({ code: "CHARACTER_RIG_NOT_FOUND" });

    for (const override of [
      { status: "draft" as const },
      { psdArtifact: null },
    ]) {
      const unreviewable = await fixture(override);
      await expect(unreviewable.service.review({
        projectId: unreviewable.projectId,
        rigVersionId: unreviewable.rig.id,
        decision: "approved",
        reason: "The rig must have verified artifacts.",
        operationId: crypto.randomUUID(),
        actorUserId: unreviewable.userId,
        reviewedAt: now,
      })).rejects.toMatchObject({ code: "CHARACTER_RIG_NOT_REVIEWABLE" });
    }

    const corrupt = await fixture();
    await corrupt.storage.purge([corrupt.rig.psdArtifact!.objectKey], []);
    await expect(corrupt.service.review({
      projectId: corrupt.projectId,
      rigVersionId: corrupt.rig.id,
      decision: "approved",
      reason: "The missing PSD must fail closed.",
      operationId: "rig-review-operation-corrupt",
      actorUserId: corrupt.userId,
      reviewedAt: now,
    })).rejects.toMatchObject({ code: "CHARACTER_RIG_ARTIFACT_INTEGRITY_FAILED" });
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
    pipeline: "source-preserving",
    failureCode: null,
    sourceFingerprint: "b".repeat(64),
    source: {
      sourceVersionId: crypto.randomUUID(),
      referenceId: crypto.randomUUID(),
      artifact: await artifact("source.png", "image/png"),
      layerDocumentRevision: 1,
      pixelIdentityRequired: true,
    },
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
    storage,
    service: new CharacterRigReviewService(repository, storage),
  };
}
