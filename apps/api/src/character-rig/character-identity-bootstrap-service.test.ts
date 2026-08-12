import type { CharacterBible, CharacterReferenceAsset } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryCharacterJobRepository } from "./character-job-repository.js";
import { CharacterIdentityBootstrapService } from "./character-identity-bootstrap-service.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";

const now = "2026-08-11T00:00:00.000Z";
const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();

describe("CharacterIdentityBootstrapService", () => {
  it("requires an approved Bible and a primary plus canonical reference", async () => {
    const rigs = new InMemoryCharacterRigRepository();
    const service = new CharacterIdentityBootstrapService(
      rigs,
      new InMemoryCharacterJobRepository(),
    );
    const draft = makeBible("draft");
    await rigs.saveBibleIfRevision(draft, null);
    await expect(service.bootstrap(inputFor(draft))).rejects.toMatchObject({
      code: "CHARACTER_BIBLE_NOT_APPROVED",
    });

    const approved = makeBible("approved", 2);
    await rigs.saveBibleIfRevision(approved, null);
    await rigs.addReference(makeReference(approved, "identity-primary"));
    await expect(service.bootstrap(inputFor(approved))).rejects.toMatchObject({
      code: "CHARACTER_REFERENCE_PACK_INCOMPLETE",
    });
  });

  it("fingerprints the pack and replays the same model and job", async () => {
    const rigs = new InMemoryCharacterRigRepository();
    const jobs = new InMemoryCharacterJobRepository();
    const service = new CharacterIdentityBootstrapService(rigs, jobs);
    const bible = makeBible("approved");
    await rigs.saveBibleIfRevision(bible, null);
    await rigs.addReference(makeReference(bible, "identity-primary"));
    await rigs.addReference(makeReference(bible, "canonical-view"));

    const first = await service.bootstrap(inputFor(bible));
    const replay = await service.bootstrap(inputFor(bible));
    expect(replay.modelVersion.id).toBe(first.modelVersion.id);
    expect(replay.job.id).toBe(first.job.id);
    expect(first.modelVersion.datasetFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.job.payload.modelVersionId).toBe(first.modelVersion.id);
  });
});

function inputFor(bible: CharacterBible) {
  return {
    projectId,
    bibleId: bible.id,
    providerKey: "private-http",
    baseModelReference: "evaluation-candidate",
    trainingConfiguration: { rank: 16, learningRate: 0.0001 },
    requestedAt: now,
  };
}

function makeBible(
  status: CharacterBible["status"],
  version = 1,
): CharacterBible {
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    version,
    revision: 1,
    status,
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
    approvedByUserId: status === "approved" ? userId : null,
    approvedAt: status === "approved" ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeReference(
  bible: CharacterBible,
  role: CharacterReferenceAsset["role"],
): CharacterReferenceAsset {
  const id = crypto.randomUUID();
  return {
    id,
    projectId,
    bibleId: bible.id,
    role,
    canonicalView: role === "canonical-view" ? "left-quarter" : "frontal",
    rightsClassification: "owned-by-user",
    rightsAttestedByUserId: userId,
    rightsAttestedAt: now,
    artifact: {
      objectKey: `references/${id}.png`,
      contentType: "image/png",
      sizeBytes: 1,
      sha256: id.replaceAll("-", "").padEnd(64, "a"),
      createdAt: now,
      retentionExpiresAt: null,
    },
    width: 100,
    height: 100,
    createdAt: now,
  };
}
