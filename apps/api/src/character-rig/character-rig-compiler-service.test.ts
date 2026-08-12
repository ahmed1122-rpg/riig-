import type {
  CharacterBible,
  CharacterGenerationAttempt,
  CharacterIdentityModelVersion,
} from "@motionprep/contracts";
import {
  characterCanonicalViews,
  characterRequiredFrontalBodyParts,
  characterRequiredHeadParts,
} from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryCharacterJobRepository } from "./character-job-repository.js";
import { CharacterRigCompilerService } from "./character-rig-compiler-service.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";

const now = "2026-08-11T00:00:00.000Z";

describe("CharacterRigCompilerService", () => {
  it("does not reuse a rig when artifact associations are swapped", async () => {
    const setup = await compilerFixture();
    const first = await setup.service.queue(compileInput(setup, "compile-first"));
    const [left, right] = setup.attempts;
    if (!left?.outputArtifact || !right?.outputArtifact) {
      throw new Error("Expected two generated part artifacts.");
    }
    await setup.rigs.saveGenerationAttempt({
      ...left,
      outputArtifact: right.outputArtifact,
    });
    await setup.rigs.saveGenerationAttempt({
      ...right,
      outputArtifact: left.outputArtifact,
    });

    const changed = await setup.service.queue(
      compileInput(setup, "compile-swapped"),
    );

    expect(changed.replayed).toBe(false);
    expect(changed.rig.id).not.toBe(first.rig.id);
  });

  it("does not reuse a rig for different canvas dimensions", async () => {
    const setup = await compilerFixture();
    const first = await setup.service.queue(compileInput(setup, "compile-size-a"));
    const changed = await setup.service.queue({
      ...compileInput(setup, "compile-size-b"),
      width: 2048,
      height: 2048,
    });

    expect(changed.replayed).toBe(false);
    expect(changed.rig.id).not.toBe(first.rig.id);
  });
});

async function compilerFixture() {
  const projectId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const rigs = new InMemoryCharacterRigRepository();
  const bible: CharacterBible = {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    revision: 1,
    status: "approved",
    displayName: "Compiler fixture",
    identityDescription: "Approved identity for deterministic rig compilation.",
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
  await rigs.saveBibleIfRevision(bible, null);
  const model: CharacterIdentityModelVersion = {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    version: 1,
    status: "ready",
    providerKey: "fake",
    providerModelReference: "fake:ready",
    baseModelReference: "fixture",
    datasetFingerprint: "a".repeat(64),
    trainingConfiguration: {},
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
  await rigs.saveIdentityModelVersion(model);
  const attempts: CharacterGenerationAttempt[] = [];
  let index = 0;
  for (const view of characterCanonicalViews) {
    const parts = [
      ...characterRequiredHeadParts,
      ...(view === "frontal" ? characterRequiredFrontalBodyParts : []),
    ];
    for (const partName of parts) {
      index += 1;
      const attempt: CharacterGenerationAttempt = {
        id: crypto.randomUUID(),
        projectId,
        bibleId: bible.id,
        identityModelVersionId: model.id,
        target: { kind: "part", view, partName },
        status: "approved",
        controls: {
          seed: index,
          poseReferenceId: null,
          depthReferenceId: null,
          maskReferenceId: null,
          parameters: {},
        },
        requestHash: index.toString(16).padStart(64, "0"),
        idempotencyKey: `compiler-part-${index}`,
        outputArtifact: {
          objectKey: `parts/${index}.png`,
          contentType: "image/png",
          sizeBytes: index,
          sha256: index.toString(16).padStart(64, "0"),
          createdAt: now,
          retentionExpiresAt: null,
        },
        qualityReport: null,
        failureCode: null,
        createdByUserId: userId,
        createdAt: new Date(Date.parse(now) + index).toISOString(),
        updatedAt: now,
      };
      await rigs.saveGenerationAttempt(attempt);
      attempts.push(attempt);
    }
  }
  return {
    projectId,
    bible,
    rigs,
    attempts,
    service: new CharacterRigCompilerService(
      rigs,
      new InMemoryCharacterJobRepository(),
    ),
  };
}

function compileInput(
  setup: Awaited<ReturnType<typeof compilerFixture>>,
  idempotencyKey: string,
) {
  return {
    projectId: setup.projectId,
    bibleId: setup.bible.id,
    width: 1024,
    height: 1024,
    idempotencyKey,
    requestedAt: now,
  };
}

