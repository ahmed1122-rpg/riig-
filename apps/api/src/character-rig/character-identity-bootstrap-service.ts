import { createHash } from "node:crypto";
import type { CharacterIdentityModelVersion } from "@motionprep/contracts";
import type { CharacterJob } from "@motionprep/contracts";
import type { CharacterJobRepository } from "./character-job-repository.js";
import { CharacterJobService } from "./character-job-service.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";
import {
  canonicalRequestJson,
  requestFingerprint,
} from "../idempotency/request-fingerprint.js";

export interface BootstrapCharacterIdentityInput {
  projectId: string;
  bibleId: string;
  providerKey: string;
  baseModelReference: string;
  trainingConfiguration: Record<string, string | number | boolean>;
  requestedAt: string;
}

export interface BootstrapCharacterIdentityResult {
  modelVersion: CharacterIdentityModelVersion;
  job: CharacterJob;
}

export class CharacterIdentityBootstrapService {
  readonly #jobService: CharacterJobService;

  constructor(
    private readonly characterRigs: CharacterRigRepository,
    jobs: CharacterJobRepository,
  ) {
    this.#jobService = new CharacterJobService(jobs);
  }

  async bootstrap(
    input: BootstrapCharacterIdentityInput,
  ): Promise<BootstrapCharacterIdentityResult> {
    const bible = await this.characterRigs.findBible(input.projectId, input.bibleId);
    if (!bible || bible.status !== "approved") {
      throw new CharacterIdentityBootstrapError("CHARACTER_BIBLE_NOT_APPROVED");
    }
    const references = await this.characterRigs.listReferences(
      input.projectId,
      input.bibleId,
    );
    if (
      references.length < 2 ||
      new Set(references.map((reference) => reference.artifact.sha256)).size < 2 ||
      !references.some((reference) => reference.role === "identity-primary") ||
      !references.some((reference) => reference.role === "canonical-view")
    ) {
      throw new CharacterIdentityBootstrapError("CHARACTER_REFERENCE_PACK_INCOMPLETE");
    }
    const datasetFingerprint = createHash("sha256")
      .update(
        references
          .map((reference) => `${reference.id}:${reference.artifact.sha256}`)
          .sort()
          .join("|"),
      )
      .digest("hex");
    const requestHash = requestFingerprint("character-identity-training", {
      bibleId: input.bibleId,
      datasetFingerprint,
      providerKey: input.providerKey,
      baseModelReference: input.baseModelReference,
      trainingConfiguration: input.trainingConfiguration,
    });
    const operationKey = `identity-train:${input.bibleId}:${requestHash}`;
    const latest = await this.characterRigs.findLatestIdentityModelVersion(
      input.projectId,
      input.bibleId,
    );
    if (
      latest?.datasetFingerprint === datasetFingerprint &&
      latest.providerKey === input.providerKey &&
      latest.baseModelReference === input.baseModelReference &&
      canonicalRequestJson(requestTrainingConfiguration(latest.trainingConfiguration)) ===
        canonicalRequestJson(input.trainingConfiguration) &&
      ["draft", "training", "ready"].includes(latest.status)
    ) {
      const job = await this.#jobService.enqueue({
        projectId: input.projectId,
        type: "train-identity",
        operationKey,
        requestHash,
        payload: { modelVersionId: latest.id },
        now: input.requestedAt,
      });
      return { modelVersion: latest, job };
    }
    const modelVersion: CharacterIdentityModelVersion = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      bibleId: input.bibleId,
      version: (latest?.version ?? 0) + 1,
      status: "draft",
      providerKey: input.providerKey,
      providerModelReference: null,
      baseModelReference: input.baseModelReference,
      datasetFingerprint,
      trainingConfiguration: structuredClone(input.trainingConfiguration),
      failureCode: null,
      createdAt: input.requestedAt,
      updatedAt: input.requestedAt,
    };
    let persistedModel = modelVersion;
    if (!(await this.characterRigs.saveIdentityModelVersion(modelVersion))) {
      const raced = await this.characterRigs.findLatestIdentityModelVersion(
        input.projectId,
        input.bibleId,
      );
      if (!raced || !matchesIdentityRequest(raced, input, datasetFingerprint)) {
        throw new CharacterIdentityBootstrapError(
          "CHARACTER_IDENTITY_VERSION_CONFLICT",
        );
      }
      persistedModel = raced;
    }
    const job = await this.#jobService.enqueue({
      projectId: input.projectId,
      type: "train-identity",
      operationKey,
      requestHash,
      payload: { modelVersionId: persistedModel.id },
      now: input.requestedAt,
    });
    return { modelVersion: persistedModel, job };
  }
}

export class CharacterIdentityBootstrapError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function requestTrainingConfiguration(
  value: Record<string, string | number | boolean>,
) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !key.startsWith("metric.")),
  );
}

function matchesIdentityRequest(
  model: CharacterIdentityModelVersion,
  input: BootstrapCharacterIdentityInput,
  datasetFingerprint: string,
): boolean {
  return (
    model.datasetFingerprint === datasetFingerprint &&
    model.providerKey === input.providerKey &&
    model.baseModelReference === input.baseModelReference &&
    canonicalRequestJson(requestTrainingConfiguration(model.trainingConfiguration)) ===
      canonicalRequestJson(input.trainingConfiguration)
  );
}
