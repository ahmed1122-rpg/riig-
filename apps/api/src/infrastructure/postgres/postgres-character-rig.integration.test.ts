import type {
  CharacterBible,
  CharacterGenerationAttempt,
  CharacterGenerationReview,
  CharacterIdentityModelVersion,
  CharacterJob,
  CharacterRigVersion,
} from "@motionprep/contracts";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PostgresCharacterJobRepository } from "./postgres-character-job-repository.js";
import { PostgresCharacterJobResultCommitter } from "./postgres-character-job-result-committer.js";
import { PostgresCharacterRigRepository } from "./postgres-character-rig-repository.js";

const databaseUrl = requireEnvironment("INTEGRATION_DATABASE_URL");
const now = "2026-08-12T00:00:00.000Z";

describe("PostgreSQL Character Rig persistence", () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: databaseUrl, max: 8 });
    await pool.query("SELECT 1");
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE TABLE users CASCADE");
  });

  afterAll(async () => {
    await pool.end();
  });

  it("persists the Character aggregate and commits one review atomically", async () => {
    const fixture = await insertProjectFixture(pool);
    const repository = new PostgresCharacterRigRepository(pool);
    const bible = makeBible(fixture);
    expect(await repository.saveBibleIfRevision(bible, null)).toBe(true);
    expect(await repository.findLatestBible(fixture.projectId)).toEqual(bible);

    const model = makeModel(fixture, bible);
    await repository.saveIdentityModelVersion(model);
    const attempt = makeAttempt(fixture, bible, model, "generation-review-001");
    await repository.saveGenerationAttempt(attempt);
    const reviewable = makeReviewable(attempt);
    await repository.saveGenerationAttempt(reviewable);
    const review: CharacterGenerationReview = {
      id: crypto.randomUUID(),
      projectId: fixture.projectId,
      generationAttemptId: attempt.id,
      decision: "approved",
      reason: "The generated identity matches the approved references.",
      reviewerUserId: fixture.userId,
      operationId: "review-operation-001",
      createdAt: now,
    };
    const approved = { ...reviewable, status: "approved" as const };

    expect(await repository.commitGenerationReview(review, approved)).toBe(true);
    expect(await repository.commitGenerationReview(review, approved)).toBe(false);
    expect(
      await repository.findGenerationAttempt(fixture.projectId, attempt.id),
    ).toMatchObject({ status: "approved" });
    expect(
      await repository.listGenerationReviews(fixture.projectId, attempt.id),
    ).toEqual([review]);
  });

  it("converges concurrent version and idempotency conflicts without database errors", async () => {
    const fixture = await insertProjectFixture(pool);
    const repository = new PostgresCharacterRigRepository(pool);
    const bibleA = makeBible(fixture);
    const bibleB = { ...makeBible(fixture), version: bibleA.version };
    const bibleResults = await Promise.all([
      repository.saveBibleIfRevision(bibleA, null),
      repository.saveBibleIfRevision(bibleB, null),
    ]);
    expect(bibleResults.filter(Boolean)).toHaveLength(1);

    const bible = (await repository.findLatestBible(fixture.projectId))!;
    const modelA = makeModel(fixture, bible);
    const modelB = { ...makeModel(fixture, bible), version: modelA.version };
    const modelResults = await Promise.all([
      repository.saveIdentityModelVersion(modelA),
      repository.saveIdentityModelVersion(modelB),
    ]);
    expect(modelResults.filter(Boolean)).toHaveLength(1);

    const model = (await repository.findLatestIdentityModelVersion(
      fixture.projectId,
      bible.id,
    ))!;
    const attemptA = makeAttempt(
      fixture,
      bible,
      model,
      "generation-concurrent-001",
    );
    const attemptB = {
      ...makeAttempt(fixture, bible, model, attemptA.idempotencyKey),
      requestHash: attemptA.requestHash,
    };
    const generationResults = await Promise.all([
      repository.saveGenerationAttempt(attemptA),
      repository.saveGenerationAttempt(attemptB),
    ]);
    expect(generationResults.filter(Boolean)).toHaveLength(1);

    const rigA = makeRig(fixture, bible);
    const rigB = { ...makeRig(fixture, bible), version: rigA.version };
    const rigResults = await Promise.all([
      repository.saveRigVersion(rigA),
      repository.saveRigVersion(rigB),
    ]);
    expect(rigResults.filter(Boolean)).toHaveLength(1);
  });

  it("converges concurrent job operation keys and recovers an expired lease", async () => {
    const fixture = await insertProjectFixture(pool);
    const jobs = new PostgresCharacterJobRepository(pool);
    const jobA = makeJob(fixture.projectId, "character-operation-001");
    const jobB = {
      ...makeJob(fixture.projectId, jobA.operationKey),
      requestHash: jobA.requestHash,
    };
    const saveResults = await Promise.all([jobs.save(jobA), jobs.save(jobB)]);
    expect(saveResults.filter(Boolean)).toHaveLength(1);

    const first = await jobs.claimNext(
      "worker-a",
      now,
      "2026-08-12T00:01:00.000Z",
    );
    expect(first).toMatchObject({ leaseOwner: "worker-a", attempt: 1 });
    expect(
      await jobs.claimNext(
        "worker-b",
        "2026-08-12T00:00:30.000Z",
        "2026-08-12T00:01:30.000Z",
      ),
    ).toBeNull();
    expect(
      await jobs.claimNext(
        "worker-b",
        "2026-08-12T00:01:00.001Z",
        "2026-08-12T00:02:00.001Z",
      ),
    ).toMatchObject({ leaseOwner: "worker-b", attempt: 2 });
  });

  it("fences a stale worker result after another worker reclaims the lease", async () => {
    const fixture = await insertProjectFixture(pool);
    const rigs = new PostgresCharacterRigRepository(pool);
    const jobs = new PostgresCharacterJobRepository(pool);
    const committer = new PostgresCharacterJobResultCommitter(pool);
    const bible = makeBible(fixture);
    await rigs.saveBibleIfRevision(bible, null);
    const model = { ...makeModel(fixture, bible), status: "draft" as const };
    await rigs.saveIdentityModelVersion(model);
    const job = {
      ...makeJob(fixture.projectId, "lease-fencing-operation"),
      payload: { modelVersionId: model.id },
    };
    await jobs.save(job);
    await jobs.claimNext("worker-a", now, "2026-08-12T00:01:00.000Z");
    await jobs.claimNext(
      "worker-b",
      "2026-08-12T00:01:00.001Z",
      "2026-08-12T00:02:00.001Z",
    );

    expect(
      await committer.commit(
        job.id,
        "worker-a",
        "2026-08-12T00:01:00.002Z",
        {
          kind: "identity-model",
          model: {
            ...model,
            status: "ready",
            providerModelReference: "stale:model",
            updatedAt: "2026-08-12T00:01:00.002Z",
          },
        },
      ),
    ).toBe(false);
    expect(
      await committer.commit(
        job.id,
        "worker-b",
        "2026-08-12T00:01:01.000Z",
        {
          kind: "identity-model",
          model: {
            ...model,
            status: "ready",
            providerModelReference: "winner:model",
            updatedAt: "2026-08-12T00:01:01.000Z",
          },
        },
      ),
    ).toBe(true);
    expect(await jobs.findById(job.id)).toMatchObject({ status: "succeeded" });
    expect(
      await rigs.findIdentityModelVersion(fixture.projectId, model.id),
    ).toMatchObject({ providerModelReference: "winner:model" });
  });
});

interface Fixture {
  userId: string;
  projectId: string;
}

async function insertProjectFixture(pool: Pool): Promise<Fixture> {
  const userId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  await pool.query(
    `INSERT INTO users (id, name, email, role, status, password_hash, created_at)
     VALUES ($1, 'Character Integration', $2, 'creator', 'active', 'hash', $3)`,
    [userId, `${userId}@example.test`, now],
  );
  await pool.query(
    `INSERT INTO projects (id, owner_user_id, name, kind, status, created_at, updated_at)
     VALUES ($1, $2, 'Character Integration', 'image', 'queued', $3, $3)`,
    [projectId, userId, now],
  );
  return { userId, projectId };
}

function makeBible(fixture: Fixture): CharacterBible {
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId: fixture.projectId,
    version: 1,
    revision: 1,
    status: "approved",
    displayName: "Integration Character",
    identityDescription: "Stable approved identity for persistence testing.",
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
    createdByUserId: fixture.userId,
    approvedByUserId: fixture.userId,
    approvedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function makeModel(
  fixture: Fixture,
  bible: CharacterBible,
): CharacterIdentityModelVersion {
  return {
    id: crypto.randomUUID(),
    projectId: fixture.projectId,
    bibleId: bible.id,
    version: 1,
    status: "ready",
    providerKey: "integration",
    providerModelReference: "integration:model",
    baseModelReference: "integration-base",
    datasetFingerprint: "a".repeat(64),
    trainingConfiguration: { rank: 16 },
    failureCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeAttempt(
  fixture: Fixture,
  bible: CharacterBible,
  model: CharacterIdentityModelVersion,
  idempotencyKey: string,
): CharacterGenerationAttempt {
  return {
    id: crypto.randomUUID(),
    projectId: fixture.projectId,
    bibleId: bible.id,
    identityModelVersionId: model.id,
    target: { kind: "canonical-view", view: "left-profile" },
    status: "queued",
    controls: {
      seed: 42,
      poseReferenceId: null,
      depthReferenceId: null,
      maskReferenceId: null,
      parameters: {},
    },
    requestHash: "b".repeat(64),
    idempotencyKey,
    outputArtifact: null,
    qualityReport: null,
    failureCode: null,
    createdByUserId: fixture.userId,
    createdAt: now,
    updatedAt: now,
  };
}

function makeReviewable(
  attempt: CharacterGenerationAttempt,
): CharacterGenerationAttempt {
  return {
    ...attempt,
    status: "needs-review",
    outputArtifact: {
      objectKey: `projects/${attempt.projectId}/character-rig/generations/${attempt.id}.png`,
      contentType: "image/png",
      sizeBytes: 1,
      sha256: "c".repeat(64),
      createdAt: now,
      retentionExpiresAt: null,
    },
    qualityReport: {
      thresholdsSchemaVersion: 1,
      landmarkMeanHeadWidthRatio: 0.01,
      landmarkCriticalPointHeadWidthRatio: 0.01,
      proportionDeviationRatio: 0.01,
      paletteMeanDeltaE00: 1,
      heroMaterialDeltaE00: 1,
      outsideMaskChangedPixelRatio: 0,
      severeDefects: [],
      passedAutomatedGate: true,
    },
  };
}

function makeRig(fixture: Fixture, bible: CharacterBible): CharacterRigVersion {
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId: fixture.projectId,
    bibleId: bible.id,
    version: 1,
    status: "draft",
    nodes: [],
    psdArtifact: null,
    manifestArtifact: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function makeJob(projectId: string, operationKey: string): CharacterJob {
  return {
    id: crypto.randomUUID(),
    projectId,
    type: "train-identity",
    status: "queued",
    operationKey,
    requestHash: "d".repeat(64),
    payload: { modelVersionId: crypto.randomUUID() },
    attempt: 0,
    maxAttempts: 3,
    nextAttemptAt: now,
    leaseOwner: null,
    leaseExpiresAt: null,
    errorCode: null,
    createdAt: now,
    updatedAt: now,
  };
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for integration tests.`);
  return value;
}
