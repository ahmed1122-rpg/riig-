import { createHash } from "node:crypto";
import type { CharacterIdentityModelVersion } from "@motionprep/contracts";
import type { CharacterJob } from "@motionprep/contracts";
import type { CharacterJobRepository } from "./character-job-repository.js";
import { CharacterJobService } from "./character-job-service.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";

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
    const requestHash = createHash("sha256")
      .update(input.bibleId)
      .update(datasetFingerprint)
      .update(input.providerKey)
      .update(input.baseModelReference)
      .update(canonicalJson(input.trainingConfiguration))
      .digest("hex");
    const operationKey = `identity-train:${input.bibleId}:${requestHash}`;
    const latest = await this.characterRigs.findLatestIdentityModelVersion(
      input.projectId,
      input.bibleId,
    );
    if (
      latest?.datasetFingerprint === datasetFingerprint &&
      latest.providerKey === input.providerKey &&
      latest.baseModelReference === input.baseModelReference &&
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
    await this.characterRigs.saveIdentityModelVersion(modelVersion);
    const job = await this.#jobService.enqueue({
      projectId: input.projectId,
      type: "train-identity",
      operationKey,
      requestHash,
      payload: { modelVersionId: modelVersion.id },
      now: input.requestedAt,
    });
    return { modelVersion, job };
  }
}

export class CharacterIdentityBootstrapError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function canonicalJson(value: Record<string, string | number | boolean>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}
