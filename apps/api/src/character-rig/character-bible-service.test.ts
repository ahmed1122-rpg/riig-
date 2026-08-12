import { describe, expect, it } from "vitest";
import { CharacterBibleService } from "./character-bible-service.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";

const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();
const now = "2026-08-11T00:00:00.000Z";

describe("CharacterBibleService", () => {
  it("creates and updates drafts with optimistic revisions", async () => {
    const service = new CharacterBibleService(new InMemoryCharacterRigRepository());
    const first = await service.saveDraft(draftInput());
    expect(first).toMatchObject({ version: 1, revision: 1, status: "draft" });
    const updated = await service.saveDraft({
      ...draftInput(),
      bibleId: first.id,
      expectedRevision: 1,
      displayName: "Adam revised",
    });
    expect(updated).toMatchObject({ id: first.id, revision: 2, displayName: "Adam revised" });
    await expect(
      service.saveDraft({ ...draftInput(), bibleId: first.id, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: "CHARACTER_BIBLE_REVISION_CONFLICT" });
  });

  it("fails closed on incomplete approval and makes an approved Bible immutable", async () => {
    const service = new CharacterBibleService(new InMemoryCharacterRigRepository());
    const incomplete = await service.saveDraft({
      ...draftInput(),
      negativeConstraints: [],
    });
    await expect(
      service.approve({
        projectId,
        bibleId: incomplete.id,
        expectedRevision: 1,
        actorUserId: userId,
        approvedAt: now,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_BIBLE_INCOMPLETE" });

    const complete = await service.saveDraft(draftInput());
    const approved = await service.approve({
      projectId,
      bibleId: complete.id,
      expectedRevision: complete.revision,
      actorUserId: userId,
      approvedAt: now,
    });
    expect(approved).toMatchObject({ status: "approved", revision: 2 });
    expect(
      await service.approve({
        projectId,
        bibleId: complete.id,
        expectedRevision: complete.revision,
        actorUserId: userId,
        approvedAt: now,
      }),
    ).toEqual(approved);
    await expect(
      service.saveDraft({ ...draftInput(), bibleId: complete.id, expectedRevision: 2 }),
    ).rejects.toMatchObject({ code: "CHARACTER_BIBLE_IMMUTABLE" });
  });
});

function draftInput(): Parameters<CharacterBibleService["saveDraft"]>[0] {
  return {
    projectId,
    bibleId: null,
    expectedRevision: null,
    displayName: "Adam",
    identityDescription: "A stable identity description for the character.",
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
    actorUserId: userId,
    updatedAt: now,
  };
}
