import type {
  CharacterRigReview,
  CharacterRigVersion,
} from "@motionprep/contracts";
import type { ObjectStorage } from "../storage/object-storage.js";
import { readVerifiedCharacterArtifact } from "./character-artifact-integrity.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";

export interface ReviewCharacterRigInput {
  projectId: string;
  rigVersionId: string;
  decision: CharacterRigReview["decision"];
  reason: string;
  operationId: string;
  actorUserId: string;
  reviewedAt: string;
}

export interface ReviewCharacterRigResult {
  rig: CharacterRigVersion;
  review: CharacterRigReview;
  replayed: boolean;
}

export class CharacterRigReviewService {
  constructor(
    private readonly repository: CharacterRigRepository,
    private readonly storage: ObjectStorage,
  ) {}

  async review(input: ReviewCharacterRigInput): Promise<ReviewCharacterRigResult> {
    const existing = await this.repository.findRigReviewByOperation(
      input.actorUserId,
      input.operationId,
    );
    if (existing) {
      if (
        existing.projectId !== input.projectId ||
        existing.rigVersionId !== input.rigVersionId ||
        existing.decision !== input.decision ||
        existing.reason !== input.reason
      ) {
        throw new CharacterRigReviewError("CHARACTER_RIG_REVIEW_IDEMPOTENCY_CONFLICT");
      }
      const rig = await this.repository.findRigVersion(
        input.projectId,
        input.rigVersionId,
      );
      if (!rig) {
        throw new CharacterRigReviewError("CHARACTER_RIG_NOT_FOUND");
      }
      return { rig, review: existing, replayed: true };
    }

    const rig = await this.repository.findRigVersion(
      input.projectId,
      input.rigVersionId,
    );
    if (!rig) {
      throw new CharacterRigReviewError("CHARACTER_RIG_NOT_FOUND");
    }
    if (
      rig.status !== "needs-review" ||
      !rig.psdArtifact ||
      !rig.manifestArtifact
    ) {
      throw new CharacterRigReviewError("CHARACTER_RIG_NOT_REVIEWABLE");
    }
    if (input.decision === "approved") {
      const [psd, manifest] = await Promise.all([
        readVerifiedCharacterArtifact(
          this.storage,
          rig.psdArtifact,
          256 * 1024 * 1024,
        ),
        readVerifiedCharacterArtifact(
          this.storage,
          rig.manifestArtifact,
          8 * 1024 * 1024,
        ),
      ]);
      if (!psd || !manifest) {
        throw new CharacterRigReviewError(
          "CHARACTER_RIG_ARTIFACT_INTEGRITY_FAILED",
        );
      }
    }

    const review: CharacterRigReview = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      rigVersionId: rig.id,
      decision: input.decision,
      reason: input.reason,
      reviewerUserId: input.actorUserId,
      operationId: input.operationId,
      createdAt: input.reviewedAt,
    };
    const updated: CharacterRigVersion = {
      ...rig,
      status: input.decision === "approved" ? "approved" : "retired",
      approvedByUserId:
        input.decision === "approved" ? input.actorUserId : null,
      approvedAt: input.decision === "approved" ? input.reviewedAt : null,
      updatedAt: input.reviewedAt,
    };

    if (!(await this.repository.commitRigReview(review, updated))) {
      const raced = await this.repository.findRigReviewByOperation(
        input.actorUserId,
        input.operationId,
      );
      if (
        raced?.projectId === input.projectId &&
        raced.rigVersionId === input.rigVersionId &&
        raced.decision === input.decision &&
        raced.reason === input.reason
      ) {
        return {
          rig:
            (await this.repository.findRigVersion(input.projectId, input.rigVersionId)) ??
            updated,
          review: raced,
          replayed: true,
        };
      }
      throw new CharacterRigReviewError("CHARACTER_RIG_REVIEW_CONFLICT");
    }
    return { rig: updated, review, replayed: false };
  }
}

export class CharacterRigReviewError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
