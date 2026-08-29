import type { CharacterJob } from "@motionprep/contracts";
import { createCharacterRigPsd } from "@motionprep/export-adapters";
import { startLeaseHeartbeat } from "../jobs/lease-heartbeat.js";
import type { ObjectStorage } from "../storage/object-storage.js";
import type { CharacterJobExecutionContext } from "./character-job-execution-context.js";
import { CharacterJobError } from "./character-job-error.js";
import {
  characterJobErrorCode,
  cleanupResultArtifacts,
  isRetryableCharacterJobError,
  optionalPayloadId,
  removeFailedArtifact,
  requiredPayloadId,
  requiredPayloadNumber,
  retryDelayMilliseconds,
  throwIfCharacterJobAborted,
} from "./character-job-execution-helpers.js";
import type { CharacterJobResult } from "./character-job-result-committer.js";

export type { CharacterJobExecutionContext } from "./character-job-execution-context.js";

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
  let pendingResult: CharacterJobResult | null = null;
  try {
    if (job.type !== "compile-rig") {
      throw new CharacterJobError("CHARACTER_GENERATION_DISABLED_SOURCE_ONLY");
    }
    pendingResult = await executeRigCompilation(context, job, now);
    if (heartbeat.leaseLost()) {
      await cleanupResultArtifacts(context, pendingResult);
      return null;
    }
    const completedAt = now().toISOString();
    if (
      !(await context.resultCommitter.commit(
        job.id,
        context.workerId,
        completedAt,
        pendingResult,
      ))
    ) {
      await cleanupResultArtifacts(context, pendingResult);
      return null;
    }
    return context.jobs.findById(job.id);
  } catch (error) {
    if (pendingResult) await cleanupResultArtifacts(context, pendingResult);
    const failedAt = now();
    if (context.signal?.aborted) {
      const released = await context.jobs.releaseClaim(
        job.id,
        context.workerId,
        failedAt.toISOString(),
      );
      return released ? context.jobs.findById(job.id) : null;
    }
    const errorCode = characterJobErrorCode(error);
    const settled = await context.jobs.retryOrFailClaim(
      job.id,
      context.workerId,
      errorCode,
      new Date(
        failedAt.getTime() + retryDelayMilliseconds(job.attempt),
      ).toISOString(),
      failedAt.toISOString(),
      isRetryableCharacterJobError(errorCode),
    );
    if (settled) {
      await reflectRigFailure(context, job, errorCode, failedAt.toISOString());
    }
    return settled;
  } finally {
    heartbeat.stop();
  }
}

async function reflectRigFailure(
  context: CharacterJobExecutionContext,
  job: CharacterJob,
  errorCode: string,
  updatedAt: string,
): Promise<void> {
  if (job.type !== "compile-rig") return;
  const rigVersionId = optionalPayloadId(job, "rigVersionId");
  if (!rigVersionId) return;
  const rig = await context.characterRigs.findRigVersion(
    job.projectId,
    rigVersionId,
  );
  if (!rig) return;
  await context.characterRigs.saveRigVersion({
    ...rig,
    failureCode: errorCode,
    updatedAt,
  });
}

async function executeRigCompilation(
  context: CharacterJobExecutionContext,
  job: CharacterJob,
  now: () => Date,
): Promise<CharacterJobResult> {
  const rigVersionId = requiredPayloadId(job, "rigVersionId");
  const width = requiredPayloadNumber(job, "width");
  const height = requiredPayloadNumber(job, "height");
  const rig = await context.characterRigs.findRigVersion(
    job.projectId,
    rigVersionId,
  );
  if (
    !rig ||
    rig.status !== "draft" ||
    rig.pipeline !== "source-preserving"
  ) {
    throw new CharacterJobError("CHARACTER_RIG_NOT_COMPILABLE");
  }

  const assets: Array<{ nodeId: string; source: Buffer }> = [];
  let totalBytes = 0;
  for (const node of rig.nodes) {
    throwIfCharacterJobAborted(context.signal);
    if (node.kind !== "raster" || !node.artifact) continue;
    const metadata = await context.storage.inspect(node.artifact.objectKey);
    if (
      !metadata ||
      metadata.sha256 !== node.artifact.sha256 ||
      metadata.sizeBytes !== node.artifact.sizeBytes ||
      metadata.contentType !== node.artifact.contentType
    ) {
      throw new CharacterJobError("CHARACTER_RIG_ASSET_INTEGRITY_FAILED");
    }
    totalBytes += metadata.sizeBytes;
    if (
      metadata.sizeBytes > 32 * 1024 * 1024 ||
      totalBytes > 256 * 1024 * 1024
    ) {
      throw new CharacterJobError("CHARACTER_RIG_ASSET_BUDGET_EXCEEDED");
    }
    const object = await context.storage.get(node.artifact.objectKey, {
      maxBytes: 32 * 1024 * 1024,
    });
    if (!object) {
      throw new CharacterJobError("CHARACTER_RIG_ASSET_NOT_FOUND");
    }
    assets.push({ nodeId: node.id, source: object.body });
  }

  const sourceArtifact = rig.source?.artifact;
  if (!sourceArtifact) {
    throw new CharacterJobError("CHARACTER_SOURCE_REQUIRED");
  }
  const sourceMetadata = await context.storage.inspect(sourceArtifact.objectKey);
  if (
    !sourceMetadata ||
    sourceMetadata.sha256 !== sourceArtifact.sha256 ||
    sourceMetadata.sizeBytes !== sourceArtifact.sizeBytes ||
    sourceMetadata.contentType !== sourceArtifact.contentType
  ) {
    throw new CharacterJobError("CHARACTER_SOURCE_INTEGRITY_FAILED");
  }
  totalBytes += sourceMetadata.sizeBytes;
  if (
    sourceMetadata.sizeBytes > 64 * 1024 * 1024 ||
    totalBytes > 256 * 1024 * 1024
  ) {
    throw new CharacterJobError("CHARACTER_RIG_ASSET_BUDGET_EXCEEDED");
  }
  const sourceObject = await context.storage.get(sourceArtifact.objectKey, {
    maxBytes: 64 * 1024 * 1024,
  });
  if (!sourceObject) {
    throw new CharacterJobError("CHARACTER_SOURCE_NOT_FOUND");
  }

  throwIfCharacterJobAborted(context.signal);
  const compiledAt = now().toISOString();
  const compiled = await createCharacterRigPsd({
    rig,
    width,
    height,
    assets,
    source: sourceObject.body,
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
  return {
    kind: "rig",
    rig: {
      ...rig,
      status: "needs-review",
      failureCode: null,
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
    },
  };
}
