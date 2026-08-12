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
import { describe, expect, it, vi } from "vitest";
import {
  InMemoryObjectStorage,
  type StoredObject,
} from "../storage/object-storage.js";
import { FakeCharacterInferenceProvider } from "./fake-character-inference-provider.js";
import { executeClaimedCharacterJob } from "./character-job-executor.js";
import { InMemoryCharacterJobResultCommitter } from "./character-job-result-committer.js";
import { InMemoryCharacterJobRepository } from "./character-job-repository.js";
import { CharacterRigCompilerService } from "./character-rig-compiler-service.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";

const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();
const now = "2026-08-11T00:00:00.000Z";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

describe("character rig compilation", () => {
  it("refuses an incomplete approved part set", async () => {
    const { service, bible } = await fixture(false);
    await expect(
      service.queue({
        projectId,
        bibleId: bible.id,
        width: 1,
        height: 1,
        idempotencyKey: "compile-incomplete-001",
        requestedAt: now,
      }),
    ).rejects.toMatchObject({ code: "CHARACTER_RIG_PARTS_INCOMPLETE" });
  });

  it("builds and stores a verified hierarchical PSD and manifest", async () => {
    const { service, rigs, jobs, storage, bible } = await fixture(
      true,
      new InMemoryObjectStorage(),
      1024,
    );
    const queued = await service.queue({
      projectId,
      bibleId: bible.id,
      width: 1024,
      height: 1024,
      idempotencyKey: "compile-complete-001",
      requestedAt: now,
    });
    expect(queued.rig.nodes.filter((node) => node.kind === "raster")).toHaveLength(42);
    const claimed = await jobs.claimNext(
      "character-worker-test",
      now,
      "2026-08-11T00:10:00.000Z",
    );
    expect(claimed?.type).toBe("compile-rig");
    const settled = await executeClaimedCharacterJob(
      {
        jobs,
        characterRigs: rigs,
        resultCommitter: new InMemoryCharacterJobResultCommitter(jobs, rigs),
        provider: new FakeCharacterInferenceProvider(),
        storage,
        workerId: "character-worker-test",
        leaseMilliseconds: 600_000,
        now: () => new Date(now),
      },
      claimed!,
    );
    expect(settled).toMatchObject({ status: "succeeded", errorCode: null });

    const compiled = await rigs.findRigVersion(projectId, queued.rig.id);
    expect(compiled).toMatchObject({ status: "needs-review" });
    expect(compiled?.psdArtifact?.contentType).toBe("image/vnd.adobe.photoshop");
    expect(compiled?.manifestArtifact?.contentType).toBe("application/json");
    expect(await storage.inspect(compiled!.psdArtifact!.objectKey)).not.toBeNull();
    expect(
      compiled?.nodes.find((node) => node.kind === "raster")?.bounds,
    ).toMatchObject({ width: 1, height: 1 });
  });

  it("reports cleanup failures instead of silently hiding orphaned artifacts", async () => {
    const storage = new FailingManifestCleanupStorage();
    const { service, rigs, jobs, bible } = await fixture(true, storage, 1024);
    await service.queue({
      projectId,
      bibleId: bible.id,
      width: 1024,
      height: 1024,
      idempotencyKey: "compile-cleanup-failure-001",
      requestedAt: now,
    });
    const claimed = await jobs.claimNext(
      "character-worker-test",
      now,
      "2026-08-11T00:10:00.000Z",
    );
    const onArtifactCleanupError = vi.fn();

    const settled = await executeClaimedCharacterJob(
      {
        jobs,
        characterRigs: rigs,
        resultCommitter: new InMemoryCharacterJobResultCommitter(jobs, rigs),
        provider: new FakeCharacterInferenceProvider(),
        storage,
        workerId: "character-worker-test",
        leaseMilliseconds: 600_000,
        now: () => new Date(now),
        onArtifactCleanupError,
      },
      claimed!,
    );

    expect(settled).toMatchObject({
      status: "queued",
      errorCode: "CHARACTER_WORKER_FAILED",
    });
    expect(onArtifactCleanupError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.stringMatching(/\.psd$/u),
    );
  });
});

async function fixture(
  complete: boolean,
  storage = new InMemoryObjectStorage(),
  canvasSize = 1,
) {
  const rigs = new InMemoryCharacterRigRepository();
  const jobs = new InMemoryCharacterJobRepository();
  const bible = makeBible();
  await rigs.saveBibleIfRevision(
    { ...bible, revision: 1, status: "draft", approvedByUserId: null, approvedAt: null },
    null,
  );
  await rigs.saveBibleIfRevision(bible, 1);
  const model = makeModel(bible);
  await rigs.saveIdentityModelVersion(model);
  if (complete) {
    let index = 0;
    for (const view of characterCanonicalViews) {
      const parts = [
        ...characterRequiredHeadParts,
        ...(view === "frontal" ? characterRequiredFrontalBodyParts : []),
      ];
      for (const partName of parts) {
        const objectKey = `projects/${projectId}/character-rig/generations/part-${index}.png`;
        const artifact = await storage.put({
          key: objectKey,
          contentType: "image/png",
          sizeBytes: png.byteLength,
          body: png,
        });
        await rigs.saveGenerationAttempt(
          makeAttempt(bible, model, index, view, partName, {
            objectKey: artifact.key,
            contentType: "image/png",
            sizeBytes: artifact.sizeBytes,
            sha256: artifact.sha256,
            createdAt: now,
            retentionExpiresAt: null,
          }, canvasSize),
        );
        index += 1;
      }
    }
  }
  return {
    service: new CharacterRigCompilerService(rigs, jobs),
    rigs,
    jobs,
    storage,
    bible,
  };
}

class FailingManifestCleanupStorage extends InMemoryObjectStorage {
  override async put(object: StoredObject) {
    if (object.contentType === "application/json") {
      throw new Error("manifest write failed");
    }
    return super.put(object);
  }

  override async delete(_key: string): Promise<void> {
    throw new Error("cleanup failed");
  }
}

function makeBible(): CharacterBible {
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    revision: 2,
    status: "approved",
    displayName: "Adam",
    identityDescription: "Stable character identity prepared for hierarchical rig compilation.",
    negativeConstraints: ["Do not change facial geometry"],
    distinguishingFeatures: ["Rounded face and narrow brows"],
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

function makeModel(bible: CharacterBible): CharacterIdentityModelVersion {
  return {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    version: 1,
    status: "ready",
    providerKey: "fake",
    providerModelReference: "fake:model",
    baseModelReference: "test",
    datasetFingerprint: "a".repeat(64),
    trainingConfiguration: {},
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeAttempt(
  bible: CharacterBible,
  model: CharacterIdentityModelVersion,
  index: number,
  view: CharacterGenerationAttempt["target"] extends { view: infer View }
    ? View
    : never,
  partName: string,
  artifact: NonNullable<CharacterGenerationAttempt["outputArtifact"]>,
  canvasSize: number,
): CharacterGenerationAttempt {
  return {
    id: crypto.randomUUID(),
    projectId,
    bibleId: bible.id,
    identityModelVersionId: model.id,
    target: { kind: "part", view, partName },
    status: "approved",
    controls: {
      canvas: { width: canvasSize, height: canvasSize },
      seed: index,
      poseReferenceId: null,
      depthReferenceId: null,
      maskReferenceId: null,
      parameters: {},
    },
    requestHash: index.toString(16).padStart(64, "0"),
    idempotencyKey: `part-generation-${String(index).padStart(3, "0")}`,
    outputArtifact: artifact,
    outputGeometry: {
      canvas: { width: canvasSize, height: canvasSize },
      bounds: {
        x: canvasSize > 1 ? index : 0,
        y: canvasSize > 1 ? index : 0,
        width: 1,
        height: 1,
      },
    },
    qualityReport: null,
    failureCode: null,
    createdByUserId: userId,
    createdAt: now,
    updatedAt: now,
  };
}
