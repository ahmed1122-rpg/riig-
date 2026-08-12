import type { CharacterBible, UploadSession } from "@motionprep/contracts";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import { InMemoryUploadRepository } from "../uploads/upload-repository.js";
import { CharacterReferenceService } from "./character-reference-service.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";

const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();
const sourceVersionId = crypto.randomUUID();
const now = new Date("2026-08-11T00:00:00.000Z");

describe("CharacterReferenceService", () => {
  it("copies a ready source into the isolated reference namespace", async () => {
    const storage = new InMemoryObjectStorage();
    const uploads = new InMemoryUploadRepository();
    const rigs = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    await rigs.saveBibleIfRevision(bible, null);
    const body = await sharp({
      create: {
        width: 3,
        height: 4,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const source = await storage.put({
      key: "uploads/source.png",
      contentType: "image/png",
      sizeBytes: body.byteLength,
      body,
    });
    await uploads.save(makeUpload(source.sha256, body.byteLength));
    const service = new CharacterReferenceService(rigs, uploads, storage, () => now);
    const reference = await service.addCurrentSource({
      projectId,
      sourceVersionId,
      bibleId: bible.id,
      role: "identity-primary",
      canonicalView: "frontal",
      rightsClassification: "owned-by-user",
      actorUserId: userId,
    });

    expect(reference).toMatchObject({ width: 3, height: 4 });
    expect(reference.artifact.objectKey).toMatch(
      new RegExp(`^projects/${projectId}/character-rig/references/`, "u"),
    );
    expect(reference.artifact.retentionExpiresAt).toBe("2026-11-09T00:00:00.000Z");
    expect(await storage.inspect(reference.artifact.objectKey)).not.toBeNull();
  });

  it("rejects unsupported source formats before copying bytes", async () => {
    const storage = new InMemoryObjectStorage();
    const uploads = new InMemoryUploadRepository();
    const rigs = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    await rigs.saveBibleIfRevision(bible, null);
    await uploads.save({ ...makeUpload("a".repeat(64), 1), contentType: "image/tiff" });

    await expect(
      new CharacterReferenceService(rigs, uploads, storage).addCurrentSource({
        projectId,
        sourceVersionId,
        bibleId: bible.id,
        role: "identity-primary",
        canonicalView: "frontal",
        rightsClassification: "owned-by-user",
        actorUserId: userId,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_REFERENCE_TYPE_UNSUPPORTED" });
  });

  it("rejects a ready upload key whose bytes no longer match the finalized hash", async () => {
    const storage = new InMemoryObjectStorage();
    const uploads = new InMemoryUploadRepository();
    const rigs = new InMemoryCharacterRigRepository();
    const bible = makeBible();
    await rigs.saveBibleIfRevision(bible, null);
    const body = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const finalized = await storage.put({
      key: "uploads/source.png",
      contentType: "image/png",
      sizeBytes: body.byteLength,
      body,
    });
    await uploads.save(makeUpload(finalized.sha256, body.byteLength));
    const replaced = Buffer.from(body);
    replaced[replaced.length - 1] = replaced[replaced.length - 1]! ^ 1;
    await storage.put({
      key: finalized.key,
      contentType: finalized.contentType,
      sizeBytes: replaced.byteLength,
      body: replaced,
    });

    await expect(
      new CharacterReferenceService(rigs, uploads, storage).addCurrentSource({
        projectId,
        sourceVersionId,
        bibleId: bible.id,
        role: "identity-primary",
        canonicalView: "frontal",
        rightsClassification: "owned-by-user",
        actorUserId: userId,
      }),
    ).rejects.toMatchObject({
      code: "CHARACTER_REFERENCE_SOURCE_INTEGRITY_FAILED",
    });
    expect(await rigs.listReferences(projectId, bible.id)).toEqual([]);
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
    approvedAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

function makeUpload(sha256: string, sizeBytes: number): UploadSession {
  return {
    uploadId: crypto.randomUUID(),
    objectKey: "uploads/source.png",
    expiresAt: "2026-08-12T00:00:00.000Z",
    maxBytes: 30 * 1024 * 1024,
    uploadUrl: "/upload",
    projectId,
    filename: "source.png",
    contentType: "image/png",
    expectedSizeBytes: sizeBytes,
    status: "ready",
    sourceVersionId,
    sha256,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}
