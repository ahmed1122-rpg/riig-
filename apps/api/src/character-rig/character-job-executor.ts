import type {
  CharacterGenerationAttempt,
  CharacterIdentityModelVersion,
  CharacterJob,
} from "@motionprep/contracts";
import { createCharacterRigPsd } from "@motionprep/export-adapters";
import type { ObjectStorage } from "../storage/object-storage.js";
import { startLeaseHeartbeat } from "../jobs/lease-heartbeat.js";
import type { CharacterInferenceProvider } from "./character-inference-provider.js";
import { CharacterProviderError } from "./character-inference-provider.js";
import type { CharacterJobRepository } from "./character-job-repository.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";
import {
  evaluateCharacterQuality,
  type CharacterQualityThresholds,
} from "./character-quality-policy.js";

export interface CharacterJobExecutionContext {
  jobs: CharacterJobRepository;
  characterRigs: CharacterRigRepository;
  provider: CharacterInferenceProvider;
  storage: ObjectStorage;
  workerId: string;
  leaseMilliseconds: number;
  now?: () => Date;
  qualityThresholds?: CharacterQualityThresholds;
  onArtifactCleanupError?: (error: unknown, objectKey: string) => void;
}

export async function executeClaimedCharacterJob(
  context: CharacterJobExecutionContext,
  job: CharacterJob,
): Promise<CharacterJob | null> {
  const now = context.now ?? (() => new Date());
  const heartbeat = startLeaseHeartbeat(
    async () => {
      const renewedAt = now();
      return context.jobs.renewClaim(
        job.id,
        context.workerId,
        renewedAt.toISOString(),
        new Date(renewedAt.getTime() + context.leaseMilliseconds).toISOString(),
      );
    },
    context.leaseMilliseconds,
  );
  try {
    if (job.type === "train-identity") {
      await executeIdentityTraining(context, job, now);
    } else if (
      ["generate-view", "generate-part", "repair-part"].includes(job.type)
    ) {
      await executeGeneration(context, job, now);
    } else if (job.type === "compile-rig") {
      await executeRigCompilation(context, job, now);
    } else {
      throw new CharacterProviderError("CHARACTER_JOB_TYPE_NOT_IMPLEMENTED");
    }
    if (heartbeat.leaseLost()) return null;
    return context.jobs.completeClaim(
      job.id,
      context.workerId,
      now().toISOString(),
    );
  } catch (error) {
    const failedAt = now();
    const errorCode = characterJobErrorCode(error);
    const settled = await context.jobs.retryOrFailClaim(
      job.id,
      context.workerId,
      errorCode,
      new Date(failedAt.getTime() + retryDelayMilliseconds(job.attempt)).toISOString(),
      failedAt.toISOString(),
    );
    if (settled) {
      await reflectJobFailure(
        context,
        job,
        settled.status === "failed",
        errorCode,
        failedAt.toISOString(),
      );
    }
    return settled;
  } finally {
    heartbeat.stop();
  }
}

async function reflectJobFailure(
  context: CharacterJobExecutionContext,
  job: CharacterJob,
  terminal: boolean,
  errorCode: string,
  updatedAt: string,
): Promise<void> {
  if (job.type === "train-identity") {
    const modelVersionId = requiredPayloadId(job, "modelVersionId");
    const model = await context.characterRigs.findIdentityModelVersion(
      job.projectId,
      modelVersionId,
    );
    if (model) {
      await context.characterRigs.saveIdentityModelVersion({
        ...model,
        status: terminal ? "failed" : "draft",
        failureCode: errorCode,
        updatedAt,
      });
    }
  } else if (
    ["generate-view", "generate-part", "repair-part"].includes(job.type)
  ) {
    const generationAttemptId = requiredPayloadId(job, "generationAttemptId");
    const attempt = await context.characterRigs.findGenerationAttempt(
      job.projectId,
      generationAttemptId,
    );
    if (attempt) {
      await context.characterRigs.saveGenerationAttempt({
        ...attempt,
        status: terminal ? "failed" : "queued",
        failureCode: errorCode,
        updatedAt,
      });
    }
  }
}

async function executeRigCompilation(
  context: CharacterJobExecutionContext,
  job: CharacterJob,
  now: () => Date,
): Promise<void> {
  const rigVersionId = requiredPayloadId(job, "rigVersionId");
  const width = requiredPayloadNumber(job, "width");
  const height = requiredPayloadNumber(job, "height");
  const rig = await context.characterRigs.findRigVersion(
    job.projectId,
    rigVersionId,
  );
  if (!rig || rig.status !== "draft") {
    throw new CharacterProviderError("CHARACTER_RIG_NOT_COMPILABLE");
  }
  const assets: Array<{ nodeId: string; source: Buffer }> = [];
  let totalBytes = 0;
  for (const node of rig.nodes) {
    if (node.kind !== "raster" || !node.artifact) continue;
    const metadata = await context.storage.inspect(node.artifact.objectKey);
    if (
      !metadata ||
      metadata.sha256 !== node.artifact.sha256 ||
      metadata.sizeBytes !== node.artifact.sizeBytes ||
      metadata.contentType !== node.artifact.contentType
    ) {
      throw new CharacterProviderError("CHARACTER_RIG_ASSET_INTEGRITY_FAILED");
    }
    totalBytes += metadata.sizeBytes;
    if (metadata.sizeBytes > 32 * 1024 * 1024 || totalBytes > 256 * 1024 * 1024) {
      throw new CharacterProviderError("CHARACTER_RIG_ASSET_BUDGET_EXCEEDED");
    }
    const object = await context.storage.get(node.artifact.objectKey, {
      maxBytes: 32 * 1024 * 1024,
    });
    if (!object) {
      throw new CharacterProviderError("CHARACTER_RIG_ASSET_NOT_FOUND");
    }
    assets.push({ nodeId: node.id, source: object.body });
  }
  const compiledAt = now().toISOString();
  const compiled = await createCharacterRigPsd({
    rig,
    width,
    height,
    assets,
    generatedAt: compiledAt,
  });
  const prefix = `projects/${job.projectId}/character-rig/rigs/${rig.id}`;
  const psdKey = `${prefix}.psd`;
  const manifestKey = `${prefix}.manifest.json`;
  const psdMetadata = await context.storage.put({
    key: psdKey,
    contentType: "image/vnd.adobe.photoshop",
    sizeBytes: compiled.psd.byteLength,
    body: compiled.psd,
  });
  const manifestBody = Buffer.from(JSON.stringify(compiled.manifest, null, 2));
  let manifestMetadata: Awaited<ReturnType<ObjectStorage["put"]>>;
  try {
    manifestMetadata = await context.storage.put({
      key: manifestKey,
      contentType: "application/json",
      sizeBytes: manifestBody.byteLength,
      body: manifestBody,
    });
  } catch (error) {
    await removeFailedArtifact(context, psdKey);
    throw error;
  }
  try {
    await context.characterRigs.saveRigVersion({
      ...rig,
      status: "needs-review",
      psdArtifact: {
        objectKey: psdMetadata.key,
        contentType: "image/vnd.adobe.photoshop",
        sizeBytes: psdMetadata.sizeBytes,
        sha256: psdMetadata.sha256,
        createdAt: compiledAt,
        retentionExpiresAt: null,
      },
      manifestArtifact: {
        objectKey: manifestMetadata.key,
        contentType: "application/json",
        sizeBytes: manifestMetadata.sizeBytes,
        sha256: manifestMetadata.sha256,
        createdAt: compiledAt,
        retentionExpiresAt: null,
      },
      updatedAt: compiledAt,
    });
  } catch (error) {
    await Promise.all([
      removeFailedArtifact(context, psdMetadata.key),
      removeFailedArtifact(context, manifestMetadata.key),
    ]);
    throw error;
  }
}

async function executeIdentityTraining(
  context: CharacterJobExecutionContext,
  job: CharacterJob,
  now: () => Date,
): Promise<void> {
  const modelVersionId = requiredPayloadId(job, "modelVersionId");
  const model = await context.characterRigs.findIdentityModelVersion(
    job.projectId,
    modelVersionId,
  );
  if (!model) throw new CharacterProviderError("CHARACTER_MODEL_NOT_FOUND");
  const bible = await context.characterRigs.findBible(job.projectId, model.bibleId);
  if (!bible) throw new CharacterProviderError("CHARACTER_BIBLE_NOT_FOUND");
  const references = await context.characterRigs.listReferences(
    job.projectId,
    bible.id,
  );
  if (references.length === 0) {
    throw new CharacterProviderError("CHARACTER_REFERENCES_REQUIRED");
  }
  const training: CharacterIdentityModelVersion = {
    ...model,
    status: "training",
    failureCode: null,
    updatedAt: now().toISOString(),
  };
  await context.characterRigs.saveIdentityModelVersion(training);
  const result = await context.provider.trainIdentity({
    bible,
    modelVersion: training,
    references,
  });
  await context.characterRigs.saveIdentityModelVersion({
    ...training,
    status: "ready",
    providerModelReference: result.providerModelReference,
    trainingConfiguration: {
      ...training.trainingConfiguration,
      ...Object.fromEntries(
        Object.entries(result.metrics).map(([key, value]) => [`metric.${key}`, value]),
      ),
    },
    updatedAt: now().toISOString(),
  });
}

async function executeGeneration(
  context: CharacterJobExecutionContext,
  job: CharacterJob,
  now: () => Date,
): Promise<void> {
  const generationAttemptId = requiredPayloadId(job, "generationAttemptId");
  const attempt = await context.characterRigs.findGenerationAttempt(
    job.projectId,
    generationAttemptId,
  );
  if (!attempt) throw new CharacterProviderError("CHARACTER_GENERATION_NOT_FOUND");
  const [bible, model, references] = await Promise.all([
    context.characterRigs.findBible(job.projectId, attempt.bibleId),
    context.characterRigs.findIdentityModelVersion(
      job.projectId,
      attempt.identityModelVersionId,
    ),
    context.characterRigs.listReferences(job.projectId, attempt.bibleId),
  ]);
  if (!bible) throw new CharacterProviderError("CHARACTER_BIBLE_NOT_FOUND");
  if (!model || model.status !== "ready") {
    throw new CharacterProviderError("CHARACTER_MODEL_NOT_READY");
  }
  const processing: CharacterGenerationAttempt = {
    ...attempt,
    status: "processing",
    failureCode: null,
    updatedAt: now().toISOString(),
  };
  await context.characterRigs.saveGenerationAttempt(processing);
  const result = await context.provider.generate({
    bible,
    modelVersion: model,
    attempt: processing,
    references,
  });
  const qualityReport = evaluateCharacterQuality(
    result.qualityReport,
    attempt.target,
    context.qualityThresholds,
  );
  const metadata = await materializeGenerationArtifact(
    context,
    job,
    attempt,
    result.artifact,
  );
  const completedAt = now().toISOString();
  try {
    await context.characterRigs.saveGenerationAttempt({
      ...processing,
      status: qualityReport.passedAutomatedGate
        ? "needs-review"
        : "rejected",
      outputArtifact: {
        objectKey: metadata.key,
        contentType: "image/png",
        sizeBytes: metadata.sizeBytes,
        sha256: metadata.sha256,
        createdAt: completedAt,
        retentionExpiresAt: null,
      },
      qualityReport,
      failureCode: qualityReport.passedAutomatedGate
        ? null
        : "CHARACTER_QUALITY_GATE_FAILED",
      updatedAt: completedAt,
    });
  } catch (error) {
    await removeFailedArtifact(context, metadata.key);
    throw error;
  }
}

async function removeFailedArtifact(
  context: CharacterJobExecutionContext,
  objectKey: string,
): Promise<void> {
  try {
    await context.storage.delete(objectKey);
  } catch (error) {
    try {
      context.onArtifactCleanupError?.(error, objectKey);
    } catch {
      // Preserve the original job failure when observability is degraded.
    }
  }
}

async function materializeGenerationArtifact(
  context: CharacterJobExecutionContext,
  job: CharacterJob,
  attempt: CharacterGenerationAttempt,
  artifact: Awaited<ReturnType<CharacterInferenceProvider["generate"]>>["artifact"],
) {
  const requiredPrefix = `projects/${job.projectId}/character-rig/`;
  if (artifact.kind === "bytes") {
    const objectKey = `${requiredPrefix}generations/${attempt.id}.png`;
    return context.storage.put({
      key: objectKey,
      contentType: artifact.contentType,
      sizeBytes: artifact.body.byteLength,
      body: artifact.body,
    });
  }
  if (!artifact.objectKey.startsWith(requiredPrefix)) {
    throw new CharacterProviderError("CHARACTER_ARTIFACT_SCOPE_INVALID");
  }
  const stored = await context.storage.inspect(artifact.objectKey);
  if (
    !stored ||
    stored.contentType !== artifact.contentType ||
    stored.sizeBytes !== artifact.sizeBytes ||
    stored.sha256 !== artifact.sha256
  ) {
    throw new CharacterProviderError("CHARACTER_ARTIFACT_INTEGRITY_FAILED");
  }
  return stored;
}

function requiredPayloadId(job: CharacterJob, key: string): string {
  const value = job.payload[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new CharacterProviderError("CHARACTER_JOB_PAYLOAD_INVALID");
  }
  return value;
}

function requiredPayloadNumber(job: CharacterJob, key: string): number {
  const value = job.payload[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new CharacterProviderError("CHARACTER_JOB_PAYLOAD_INVALID");
  }
  return value;
}

function characterJobErrorCode(error: unknown): string {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    /^CHARACTER_|^RASTER_/u.test(error.code)
    ? error.code
    : "CHARACTER_WORKER_FAILED";
}

function retryDelayMilliseconds(attempt: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}
