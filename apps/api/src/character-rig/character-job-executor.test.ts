import type { CharacterBible, CharacterRigVersion } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import { InMemoryCharacterJobRepository } from "./character-job-repository.js";
import { executeClaimedCharacterJob } from "./character-job-executor.js";
import { InMemoryCharacterJobResultCommitter } from "./character-job-result-committer.js";
import { CharacterJobService } from "./character-job-service.js";
import { InMemoryCharacterRigRepository } from "./character-rig-repository.js";

const projectId = crypto.randomUUID();
const initialTime = new Date("2026-08-11T00:00:00.000Z");
const compileOperationId = "compile-operation-1";

describe("character job runtime", () => {
  it("queues idempotently and rejects request-hash reuse", async () => {
    const jobs = new InMemoryCharacterJobRepository();
    const service = new CharacterJobService(jobs);
    const input = {
      projectId,
      type: "compile-rig" as const,
      operationKey: compileOperationId,
      requestHash: "a".repeat(64),
      payload: {
        rigVersionId: crypto.randomUUID(),
        width: 128,
        height: 128,
      },
      now: initialTime.toISOString(),
    };

    const first = await service.enqueue(input);
    expect(await service.enqueue(input)).toEqual(first);
    await expect(
      service.enqueue({ ...input, requestHash: "b".repeat(64) }),
    ).rejects.toMatchObject({ code: "CHARACTER_JOB_IDEMPOTENCY_CONFLICT" });
  });

  it("claims with a lease and recovers only after expiry", async () => {
    const jobs = new InMemoryCharacterJobRepository();
    await enqueueCompile(jobs, "lease-operation-1");
    const first = await jobs.claimNext(
      "worker-a",
      initialTime.toISOString(),
      new Date(initialTime.getTime() + 60_000).toISOString(),
    );

    expect(first?.attempt).toBe(1);
    await expect(
      jobs.claimNext(
        "worker-b",
        new Date(initialTime.getTime() + 30_000).toISOString(),
        new Date(initialTime.getTime() + 90_000).toISOString(),
      ),
    ).resolves.toBeNull();
    await expect(
      jobs.claimNext(
        "worker-b",
        new Date(initialTime.getTime() + 60_001).toISOString(),
        new Date(initialTime.getTime() + 120_001).toISOString(),
      ),
    ).resolves.toMatchObject({ leaseOwner: "worker-b", attempt: 2 });
  });

  it("releases a shutdown claim for immediate retry without consuming an attempt", async () => {
    const jobs = new InMemoryCharacterJobRepository();
    await enqueueCompile(jobs, "shutdown-release-operation");
    const first = await claim(jobs);

    expect(
      await jobs.releaseClaim(
        first.id,
        "worker-a",
        new Date(initialTime.getTime() + 1_000).toISOString(),
      ),
    ).toBe(true);
    await expect(
      jobs.claimNext(
        "worker-b",
        new Date(initialTime.getTime() + 1_001).toISOString(),
        new Date(initialTime.getTime() + 61_001).toISOString(),
      ),
    ).resolves.toMatchObject({ leaseOwner: "worker-b", attempt: 1 });
  });

  it("fails legacy training jobs closed without contacting an external provider", async () => {
    const setup = createContext();
    await setup.jobs.save({
      id: crypto.randomUUID(),
      projectId,
      type: "train-identity",
      status: "queued",
      operationKey: "retired-training-operation",
      requestHash: "d".repeat(64),
      payload: { modelVersionId: crypto.randomUUID() },
      attempt: 0,
      maxAttempts: 3,
      nextAttemptAt: initialTime.toISOString(),
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      createdAt: initialTime.toISOString(),
      updatedAt: initialTime.toISOString(),
    });

    const settled = await executeClaimedCharacterJob(
      { ...setup.context, now: advancingClock() },
      await claim(setup.jobs),
    );

    expect(settled).toMatchObject({
      status: "failed",
      errorCode: "CHARACTER_GENERATION_DISABLED_SOURCE_ONLY",
      attempt: 1,
    });
  });

  it("persists a terminal source compile failure on the rig snapshot", async () => {
    const setup = createContext();
    const rig = makeRigWithMissingRaster();
    await setup.rigs.saveBibleIfRevision(makeBible(rig.bibleId), null);
    await setup.rigs.saveRigVersion(rig);
    await enqueueCompile(
      setup.jobs,
      "compile-terminal-failure",
      rig.id,
      1,
    );

    const settled = await executeClaimedCharacterJob(
      { ...setup.context, now: advancingClock() },
      await claim(setup.jobs),
    );

    expect(settled).toMatchObject({
      status: "failed",
      errorCode: "CHARACTER_RIG_ASSET_INTEGRITY_FAILED",
    });
    await expect(
      setup.rigs.findRigVersion(projectId, rig.id),
    ).resolves.toMatchObject({
      status: "draft",
      failureCode: "CHARACTER_RIG_ASSET_INTEGRITY_FAILED",
    });
  });
});

function createContext() {
  const jobs = new InMemoryCharacterJobRepository();
  const rigs = new InMemoryCharacterRigRepository();
  const storage = new InMemoryObjectStorage();
  return {
    jobs,
    rigs,
    context: {
      jobs,
      characterRigs: rigs,
      resultCommitter: new InMemoryCharacterJobResultCommitter(jobs, rigs),
      storage,
      workerId: "worker-a",
      leaseMilliseconds: 60_000,
    },
  };
}

function makeRigWithMissingRaster(): CharacterRigVersion {
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId,
    bibleId: crypto.randomUUID(),
    version: 1,
    pipeline: "source-preserving",
    sourceFingerprint: "f".repeat(64),
    source: {
      sourceVersionId: crypto.randomUUID(),
      referenceId: crypto.randomUUID(),
      artifact: {
        objectKey: `projects/${projectId}/uploads/source.png`,
        contentType: "image/png",
        sizeBytes: 1,
        sha256: "b".repeat(64),
        createdAt: initialTime.toISOString(),
        retentionExpiresAt: null,
      },
      layerDocumentRevision: 1,
      pixelIdentityRequired: true,
    },
    status: "draft",
    failureCode: null,
    canvas: { width: 128, height: 128 },
    nodes: [
      {
        id: crypto.randomUUID(),
        parentId: null,
        kind: "raster",
        name: "+Head",
        canonicalView: "frontal",
        semanticPart: "head",
        sourceLayerId: crypto.randomUUID(),
        artifact: {
          objectKey: `projects/${projectId}/character-rig/missing.png`,
          contentType: "image/png",
          sizeBytes: 1,
          sha256: "a".repeat(64),
          createdAt: initialTime.toISOString(),
          retentionExpiresAt: null,
        },
        bounds: { x: 0, y: 0, width: 128, height: 128 },
        visible: true,
        locked: false,
        opacity: 1,
        zIndex: 0,
      },
    ],
    psdArtifact: null,
    manifestArtifact: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: initialTime.toISOString(),
    updatedAt: initialTime.toISOString(),
  };
}

function makeBible(id: string): CharacterBible {
  return {
    schemaVersion: "1.0",
    id,
    projectId,
    version: 1,
    revision: 1,
    status: "approved",
    displayName: "Source character",
    identityDescription: "Metadata for the uploaded source.",
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
    createdByUserId: crypto.randomUUID(),
    approvedByUserId: crypto.randomUUID(),
    approvedAt: initialTime.toISOString(),
    createdAt: initialTime.toISOString(),
    updatedAt: initialTime.toISOString(),
  };
}

async function enqueueCompile(
  jobs: InMemoryCharacterJobRepository,
  operationKey: string,
  rigVersionId: string = crypto.randomUUID(),
  maxAttempts = 5,
) {
  return new CharacterJobService(jobs).enqueue({
    projectId,
    type: "compile-rig",
    operationKey,
    requestHash: crypto.randomUUID().replaceAll("-", "").repeat(2),
    payload: { rigVersionId, width: 128, height: 128 },
    maxAttempts,
    now: initialTime.toISOString(),
  });
}

async function claim(jobs: InMemoryCharacterJobRepository) {
  const job = await jobs.claimNext(
    "worker-a",
    initialTime.toISOString(),
    new Date(initialTime.getTime() + 60_000).toISOString(),
  );
  if (!job) throw new Error("Expected a claimed character job.");
  return job;
}

function advancingClock() {
  let tick = 0;
  return () => new Date(initialTime.getTime() + ++tick * 100);
}
