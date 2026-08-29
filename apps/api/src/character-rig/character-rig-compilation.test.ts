import type {
  CharacterBible,
  CharacterReferenceAsset,
  LayerDocument,
} from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { InMemoryLayerDocumentRepository } from "../processing/processing-repository.js";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import { executeClaimedCharacterJob } from "./character-job-executor.js";
import { InMemoryCharacterJobResultCommitter } from "./character-job-result-committer.js";
import { InMemoryCharacterJobRepository } from "./character-job-repository.js";
import { CharacterRigCompilerService } from "./character-rig-compiler-service.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";

const now = "2026-08-28T00:00:00.000Z";

describe("source-preserving character rig compilation", () => {
  it("builds a PSD only when source layers reproduce the upload exactly", async () => {
    const setup = await fixture(false);
    const queued = await setup.service.queue(compileInput(setup, "compile-exact"));

    const settled = await executeQueued(setup);

    expect(settled).toMatchObject({ status: "succeeded", errorCode: null });
    const compiled = await setup.rigs.findRigVersion(
      setup.projectId,
      queued.rig.id,
    );
    expect(compiled).toMatchObject({
      pipeline: "source-preserving",
      status: "needs-review",
    });
    expect(compiled?.nodes.filter((node) => node.kind === "raster")).toHaveLength(1);
    const manifestObject = await setup.storage.get(
      compiled!.manifestArtifact!.objectKey,
      { maxBytes: 1024 * 1024 },
    );
    const manifest = JSON.parse(manifestObject!.body.toString("utf8"));
    expect(manifest).toMatchObject({
      canonicalViews: ["frontal"],
      sourceIntegrity: {
        mode: "pixel-exact",
        sourceVersionId: setup.sourceVersionId,
        verified: true,
      },
    });
  });

  it("fails closed when layer composition drifts from the uploaded source", async () => {
    const setup = await fixture(true);
    await setup.service.queue(compileInput(setup, "compile-mismatch"));

    const settled = await executeQueued(setup);

    expect(settled).toMatchObject({
      status: "failed",
      errorCode: "CHARACTER_SOURCE_COMPOSITE_MISMATCH",
    });
    const latest = await setup.rigs.findLatestRigVersion(
      setup.projectId,
      setup.bible.id,
    );
    expect(latest?.psdArtifact).toBeNull();
  });

  it("refuses compilation without a reference tied to the current upload", async () => {
    const setup = await fixture(false, false);

    await expect(
      setup.service.queue(compileInput(setup, "compile-no-source")),
    ).rejects.toMatchObject({ code: "CHARACTER_SOURCE_REFERENCE_REQUIRED" });
  });
});

async function executeQueued(setup: Awaited<ReturnType<typeof fixture>>) {
  const claimed = await setup.jobs.claimNext(
    "character-source-worker-test",
    now,
    "2026-08-28T00:10:00.000Z",
  );
  expect(claimed?.type).toBe("compile-rig");
  return executeClaimedCharacterJob(
    {
      jobs: setup.jobs,
      characterRigs: setup.rigs,
      resultCommitter: new InMemoryCharacterJobResultCommitter(
        setup.jobs,
        setup.rigs,
      ),
      storage: setup.storage,
      workerId: "character-source-worker-test",
      leaseMilliseconds: 600_000,
      now: () => new Date(now),
    },
    claimed!,
  );
}

async function fixture(mismatch: boolean, addReference = true) {
  const projectId = crypto.randomUUID();
  const sourceVersionId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const rigs = new InMemoryCharacterRigRepository();
  const jobs = new InMemoryCharacterJobRepository();
  const documents = new InMemoryLayerDocumentRepository();
  const storage = new InMemoryObjectStorage();
  const bible = makeBible(projectId, userId);
  await rigs.saveBibleIfRevision(bible, null);

  const sourcePng = await pixelPng({ r: 20, g: 60, b: 120, alpha: 1 });
  const layerPng = mismatch
    ? await pixelPng({ r: 220, g: 30, b: 10, alpha: 1 })
    : sourcePng;
  const sourceObject = await storage.put({
    key: `projects/${projectId}/character-rig/references/source.png`,
    contentType: "image/png",
    sizeBytes: sourcePng.byteLength,
    body: sourcePng,
  });
  const layerObject = await storage.put({
    key: `projects/${projectId}/layers/source.png`,
    contentType: "image/png",
    sizeBytes: layerPng.byteLength,
    body: layerPng,
  });
  if (addReference) {
    const reference: CharacterReferenceAsset = {
      id: crypto.randomUUID(),
      projectId,
      bibleId: bible.id,
      sourceVersionId,
      role: "identity-primary",
      canonicalView: "frontal",
      rightsClassification: "owned-by-user",
      rightsAttestedByUserId: userId,
      rightsAttestedAt: now,
      artifact: {
        objectKey: sourceObject.key,
        contentType: "image/png",
        sizeBytes: sourceObject.sizeBytes,
        sha256: sourceObject.sha256,
        createdAt: now,
        retentionExpiresAt: null,
      },
      width: 1,
      height: 1,
      createdAt: now,
    };
    await rigs.addReference(reference);
  }
  const document: LayerDocument = {
    schemaVersion: "1.0",
    projectId,
    sourceVersionId,
    revision: 1,
    generatedAt: now,
    width: 1,
    height: 1,
    colorSpace: "sRGB",
    layers: [
      {
        id: crypto.randomUUID(),
        parentId: null,
        kind: "raster",
        name: "+Source",
        visible: true,
        locked: false,
        opacity: 1,
        fixed: false,
        zIndex: 0,
        bounds: { x: 0, y: 0, width: 1, height: 1 },
        rasterAsset: {
          objectKey: layerObject.key,
          contentType: "image/png",
          sizeBytes: layerObject.sizeBytes,
          sha256: layerObject.sha256,
        },
      },
    ],
  };
  await documents.save(document);
  return {
    projectId,
    sourceVersionId,
    bible,
    rigs,
    jobs,
    storage,
    service: new CharacterRigCompilerService(rigs, jobs, documents),
  };
}

function makeBible(projectId: string, userId: string): CharacterBible {
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    version: 1,
    revision: 1,
    status: "approved",
    displayName: "Source-locked character",
    identityDescription: "The uploaded image is preserved exactly during export.",
    negativeConstraints: ["Never generate replacement pixels"],
    distinguishingFeatures: ["Every uploaded pixel is immutable"],
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

function pixelPng(background: { r: number; g: number; b: number; alpha: number }) {
  return sharp({
    create: { width: 1, height: 1, channels: 4, background },
  }).png().toBuffer();
}

function compileInput(
  setup: Awaited<ReturnType<typeof fixture>>,
  idempotencyKey: string,
) {
  return {
    projectId: setup.projectId,
    sourceVersionId: setup.sourceVersionId,
    bibleId: setup.bible.id,
    width: 1,
    height: 1,
    idempotencyKey,
    requestedAt: now,
  };
}
