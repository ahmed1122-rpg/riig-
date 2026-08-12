import type {
  CharacterGenerationAttempt,
  CharacterGenerationControls,
  CharacterGenerationReview,
  CharacterGenerationTarget,
  CharacterJob,
} from "@motionprep/contracts";
import type { CharacterJobRepository } from "./character-job-repository.js";
import { CharacterJobService } from "./character-job-service.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";
import { requestFingerprint } from "../idempotency/request-fingerprint.js";

export interface QueueCharacterGenerationInput {
  projectId: string;
  bibleId: string;
  identityModelVersionId: string;
  target: CharacterGenerationTarget;
  controls: CharacterGenerationControls;
  idempotencyKey: string;
  actorUserId: string;
  requestedAt: string;
}

export interface QueueCharacterGenerationResult {
  attempt: CharacterGenerationAttempt;
  job: CharacterJob;
  replayed: boolean;
}

export interface ReviewCharacterGenerationInput {
  projectId: string;
  generationAttemptId: string;
  decision: CharacterGenerationReview["decision"];
  reason: string;
  operationId: string;
  actorUserId: string;
  reviewedAt: string;
}

export class CharacterGenerationService {
  readonly #jobs: CharacterJobService;

  constructor(
    private readonly repository: CharacterRigRepository,
    jobs: CharacterJobRepository,
  ) {
    this.#jobs = new CharacterJobService(jobs);
  }

  async queue(
    input: QueueCharacterGenerationInput,
  ): Promise<QueueCharacterGenerationResult> {
    const [bible, model, references] = await Promise.all([
      this.repository.findBible(input.projectId, input.bibleId),
      this.repository.findIdentityModelVersion(
        input.projectId,
        input.identityModelVersionId,
      ),
      this.repository.listReferences(input.projectId, input.bibleId),
    ]);
    if (!bible || bible.status !== "approved") {
      throw new CharacterGenerationError("CHARACTER_BIBLE_NOT_APPROVED");
    }
    if (
      !model ||
      model.bibleId !== bible.id ||
      model.status !== "ready" ||
      !model.providerModelReference
    ) {
      throw new CharacterGenerationError("CHARACTER_MODEL_NOT_READY");
    }
    validateControls(input.target, input.controls, references);
    const requestHash = requestFingerprint("character-generation", {
      bibleId: bible.id,
      modelVersionId: model.id,
      target: input.target,
      controls: input.controls,
    });
    const existing = await this.repository.findGenerationByIdempotencyKey(
      input.projectId,
      input.idempotencyKey,
    );
    if (existing && existing.requestHash !== requestHash) {
      throw new CharacterGenerationError("CHARACTER_GENERATION_IDEMPOTENCY_CONFLICT");
    }
    let replayed = Boolean(existing);
    let attempt: CharacterGenerationAttempt =
      existing ?? {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        bibleId: bible.id,
        identityModelVersionId: model.id,
        target: structuredClone(input.target),
        status: "queued",
        controls: structuredClone(input.controls),
        requestHash,
        idempotencyKey: input.idempotencyKey,
        outputArtifact: null,
        qualityReport: null,
        failureCode: null,
        createdByUserId: input.actorUserId,
        createdAt: input.requestedAt,
        updatedAt: input.requestedAt,
      };
    if (!existing && !(await this.repository.saveGenerationAttempt(attempt))) {
      const raced = await this.repository.findGenerationByIdempotencyKey(
        input.projectId,
        input.idempotencyKey,
      );
      if (!raced || raced.requestHash !== requestHash) {
        throw new CharacterGenerationError(
          "CHARACTER_GENERATION_IDEMPOTENCY_CONFLICT",
        );
      }
      attempt = raced;
      replayed = true;
    }
    const job = await this.#jobs.enqueue({
      projectId: input.projectId,
      type: jobTypeFor(input.target),
      operationKey: `generation:${input.idempotencyKey}`,
      requestHash,
      payload: { generationAttemptId: attempt.id },
      now: input.requestedAt,
    });
    return { attempt, job, replayed };
  }

  async review(input: ReviewCharacterGenerationInput): Promise<{
    attempt: CharacterGenerationAttempt;
    review: CharacterGenerationReview;
    replayed: boolean;
  }> {
    const attempt = await this.repository.findGenerationAttempt(
      input.projectId,
      input.generationAttemptId,
    );
    if (!attempt) {
      throw new CharacterGenerationError("CHARACTER_GENERATION_NOT_FOUND");
    }
    const reviews = await this.repository.listGenerationReviews(
      input.projectId,
      attempt.id,
    );
    const existing = reviews.find(
      (review) =>
        review.reviewerUserId === input.actorUserId &&
        review.operationId === input.operationId,
    );
    if (existing) {
      if (
        existing.decision !== input.decision ||
        existing.reason !== input.reason
      ) {
        throw new CharacterGenerationError(
          "CHARACTER_REVIEW_IDEMPOTENCY_CONFLICT",
        );
      }
      return {
        attempt:
          (await this.repository.findGenerationAttempt(
            input.projectId,
            attempt.id,
          )) ?? attempt,
        review: existing,
        replayed: true,
      };
    }
    if (
      attempt.status !== "needs-review" ||
      !attempt.outputArtifact ||
      !attempt.qualityReport?.passedAutomatedGate
    ) {
      throw new CharacterGenerationError("CHARACTER_GENERATION_NOT_REVIEWABLE");
    }
    const review: CharacterGenerationReview = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      generationAttemptId: attempt.id,
      decision: input.decision,
      reason: input.reason,
      reviewerUserId: input.actorUserId,
      operationId: input.operationId,
      createdAt: input.reviewedAt,
    };
    const updated: CharacterGenerationAttempt = {
      ...attempt,
      status:
        input.decision === "approved"
          ? "approved"
          : input.decision === "rejected"
            ? "rejected"
            : "needs-review",
      failureCode:
        input.decision === "rejected" ? "CHARACTER_REVIEW_REJECTED" : null,
      updatedAt: input.reviewedAt,
    };
    if (!(await this.repository.commitGenerationReview(review, updated))) {
      const racedReviews = await this.repository.listGenerationReviews(
        input.projectId,
        attempt.id,
      );
      const replay = racedReviews.find(
        (candidate) =>
          candidate.reviewerUserId === input.actorUserId &&
          candidate.operationId === input.operationId &&
          candidate.decision === input.decision &&
          candidate.reason === input.reason,
      );
      if (replay) {
        return {
          attempt:
            (await this.repository.findGenerationAttempt(
              input.projectId,
              attempt.id,
            )) ?? attempt,
          review: replay,
          replayed: true,
        };
      }
      throw new CharacterGenerationError("CHARACTER_REVIEW_CONFLICT");
    }
    return { attempt: updated, review, replayed: false };
  }
}

export class CharacterGenerationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function validateControls(
  target: CharacterGenerationTarget,
  controls: CharacterGenerationControls,
  references: Awaited<
    ReturnType<CharacterRigRepository["listReferences"]>
  >,
): void {
  const byId = new Map(references.map((reference) => [reference.id, reference]));
  const requiredRoleByControl = [
    [controls.poseReferenceId, "pose-control"],
    [controls.depthReferenceId, "depth-control"],
    [controls.maskReferenceId, "part-mask"],
  ] as const;
  for (const [referenceId, requiredRole] of requiredRoleByControl) {
    if (referenceId && byId.get(referenceId)?.role !== requiredRole) {
      throw new CharacterGenerationError("CHARACTER_CONTROL_REFERENCE_INVALID");
    }
  }
  if (target.kind === "masked-repair" && !controls.maskReferenceId) {
    throw new CharacterGenerationError("CHARACTER_REPAIR_MASK_REQUIRED");
  }
}

function jobTypeFor(
  target: CharacterGenerationTarget,
): "generate-view" | "generate-part" | "repair-part" {
  if (target.kind === "canonical-view") return "generate-view";
  return target.kind === "part" ? "generate-part" : "repair-part";
}
