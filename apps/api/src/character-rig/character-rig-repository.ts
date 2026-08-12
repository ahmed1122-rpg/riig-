import type {
  CharacterBible,
  CharacterGenerationAttempt,
  CharacterGenerationReview,
  CharacterIdentityModelVersion,
  CharacterReferenceAsset,
  CharacterRigReview,
  CharacterRigVersion,
} from "@motionprep/contracts";

export interface CharacterRigRepository {
  findBible(projectId: string, bibleId: string): Promise<CharacterBible | null>;
  findLatestBible(projectId: string): Promise<CharacterBible | null>;
  saveBibleIfRevision(
    bible: CharacterBible,
    expectedRevision: number | null,
  ): Promise<boolean>;
  addReference(reference: CharacterReferenceAsset): Promise<boolean>;
  listReferences(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterReferenceAsset[]>;
  findIdentityModelVersion(
    projectId: string,
    modelVersionId: string,
  ): Promise<CharacterIdentityModelVersion | null>;
  findLatestIdentityModelVersion(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterIdentityModelVersion | null>;
  saveIdentityModelVersion(model: CharacterIdentityModelVersion): Promise<boolean>;
  findGenerationAttempt(
    projectId: string,
    generationAttemptId: string,
  ): Promise<CharacterGenerationAttempt | null>;
  findGenerationByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<CharacterGenerationAttempt | null>;
  listGenerationAttempts(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterGenerationAttempt[]>;
  saveGenerationAttempt(attempt: CharacterGenerationAttempt): Promise<boolean>;
  commitGenerationReview(
    review: CharacterGenerationReview,
    updatedAttempt: CharacterGenerationAttempt,
  ): Promise<boolean>;
  listGenerationReviews(
    projectId: string,
    generationAttemptId: string,
  ): Promise<CharacterGenerationReview[]>;
  findRigVersion(
    projectId: string,
    rigVersionId: string,
  ): Promise<CharacterRigVersion | null>;
  findLatestRigVersion(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterRigVersion | null>;
  findRigReviewByOperation(
    reviewerUserId: string,
    operationId: string,
  ): Promise<CharacterRigReview | null>;
  commitRigReview(
    review: CharacterRigReview,
    updatedRig: CharacterRigVersion,
  ): Promise<boolean>;
  saveRigVersion(rig: CharacterRigVersion): Promise<boolean>;
}

export class InMemoryCharacterRigRepository implements CharacterRigRepository {
  readonly #bibles = new Map<string, CharacterBible>();
  readonly #references = new Map<string, CharacterReferenceAsset>();
  readonly #models = new Map<string, CharacterIdentityModelVersion>();
  readonly #generations = new Map<string, CharacterGenerationAttempt>();
  readonly #reviews = new Map<string, CharacterGenerationReview>();
  readonly #rigs = new Map<string, CharacterRigVersion>();
  readonly #rigReviews = new Map<string, CharacterRigReview>();

  async findBible(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterBible | null> {
    return cloneWhenProjectMatches(this.#bibles.get(bibleId), projectId);
  }

  async findLatestBible(projectId: string): Promise<CharacterBible | null> {
    const bible = [...this.#bibles.values()]
      .filter((candidate) => candidate.projectId === projectId)
      .sort((left, right) => right.version - left.version)[0];
    return bible ? structuredClone(bible) : null;
  }

  async saveBibleIfRevision(
    bible: CharacterBible,
    expectedRevision: number | null,
  ): Promise<boolean> {
    const current = this.#bibles.get(bible.id);
    const versionConflict = [...this.#bibles.values()].some(
      (candidate) =>
        candidate.id !== bible.id &&
        candidate.projectId === bible.projectId &&
        candidate.version === bible.version,
    );
    if (
      versionConflict ||
      (expectedRevision === null
        ? current !== undefined || bible.revision !== 1
        : current?.projectId !== bible.projectId ||
          current.revision !== expectedRevision ||
          bible.revision !== expectedRevision + 1)
    ) {
      return false;
    }
    this.#bibles.set(bible.id, structuredClone(bible));
    return true;
  }

  async addReference(reference: CharacterReferenceAsset): Promise<boolean> {
    if (
      this.#references.has(reference.id) ||
      !this.relatedBibleExists(reference.projectId, reference.bibleId)
    ) {
      return false;
    }
    this.#references.set(reference.id, structuredClone(reference));
    return true;
  }

  async listReferences(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterReferenceAsset[]> {
    return [...this.#references.values()]
      .filter(
        (reference) =>
          reference.projectId === projectId && reference.bibleId === bibleId,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((reference) => structuredClone(reference));
  }

  async findIdentityModelVersion(
    projectId: string,
    modelVersionId: string,
  ): Promise<CharacterIdentityModelVersion | null> {
    return cloneWhenProjectMatches(this.#models.get(modelVersionId), projectId);
  }

  async findLatestIdentityModelVersion(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterIdentityModelVersion | null> {
    const model = [...this.#models.values()]
      .filter(
        (candidate) =>
          candidate.projectId === projectId && candidate.bibleId === bibleId,
      )
      .sort((left, right) => right.version - left.version)[0];
    return model ? structuredClone(model) : null;
  }

  async saveIdentityModelVersion(
    model: CharacterIdentityModelVersion,
  ): Promise<boolean> {
    if (!this.relatedBibleExists(model.projectId, model.bibleId)) {
      throw new Error("Identity model must reference a bible in the same project.");
    }
    const conflict = [...this.#models.values()].some(
      (candidate) =>
        candidate.id !== model.id &&
        candidate.bibleId === model.bibleId &&
        candidate.version === model.version,
    );
    if (conflict) return false;
    this.#models.set(model.id, structuredClone(model));
    return true;
  }

  async findGenerationAttempt(
    projectId: string,
    generationAttemptId: string,
  ): Promise<CharacterGenerationAttempt | null> {
    return cloneWhenProjectMatches(
      this.#generations.get(generationAttemptId),
      projectId,
    );
  }

  async findGenerationByIdempotencyKey(
    projectId: string,
    idempotencyKey: string,
  ): Promise<CharacterGenerationAttempt | null> {
    const attempt = [...this.#generations.values()].find(
      (candidate) =>
        candidate.projectId === projectId &&
        candidate.idempotencyKey === idempotencyKey,
    );
    return attempt ? structuredClone(attempt) : null;
  }

  async listGenerationAttempts(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterGenerationAttempt[]> {
    return [...this.#generations.values()]
      .filter(
        (attempt) =>
          attempt.projectId === projectId && attempt.bibleId === bibleId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((attempt) => structuredClone(attempt));
  }

  async saveGenerationAttempt(
    attempt: CharacterGenerationAttempt,
  ): Promise<boolean> {
    const model = this.#models.get(attempt.identityModelVersionId);
    if (
      !this.relatedBibleExists(attempt.projectId, attempt.bibleId) ||
      model?.projectId !== attempt.projectId ||
      model.bibleId !== attempt.bibleId
    ) {
      throw new Error("Generation must reference a model and bible in the same project.");
    }
    const operationConflict = [...this.#generations.values()].some(
      (candidate) =>
        candidate.id !== attempt.id &&
        candidate.projectId === attempt.projectId &&
        candidate.idempotencyKey === attempt.idempotencyKey,
    );
    if (operationConflict) return false;
    this.#generations.set(attempt.id, structuredClone(attempt));
    return true;
  }

  async commitGenerationReview(
    review: CharacterGenerationReview,
    updatedAttempt: CharacterGenerationAttempt,
  ): Promise<boolean> {
    const current = this.#generations.get(review.generationAttemptId);
    const operationConflict = [...this.#reviews.values()].some(
      (candidate) =>
        candidate.reviewerUserId === review.reviewerUserId &&
        candidate.operationId === review.operationId,
    );
    if (
      !current ||
      current.projectId !== review.projectId ||
      current.status !== "needs-review" ||
      updatedAttempt.id !== current.id ||
      updatedAttempt.projectId !== current.projectId ||
      !["approved", "rejected", "needs-review"].includes(updatedAttempt.status) ||
      operationConflict
    ) {
      return false;
    }
    this.#reviews.set(review.id, structuredClone(review));
    this.#generations.set(updatedAttempt.id, structuredClone(updatedAttempt));
    return true;
  }

  async listGenerationReviews(
    projectId: string,
    generationAttemptId: string,
  ): Promise<CharacterGenerationReview[]> {
    return [...this.#reviews.values()]
      .filter(
        (review) =>
          review.projectId === projectId &&
          review.generationAttemptId === generationAttemptId,
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((review) => structuredClone(review));
  }

  async findRigVersion(
    projectId: string,
    rigVersionId: string,
  ): Promise<CharacterRigVersion | null> {
    return cloneWhenProjectMatches(this.#rigs.get(rigVersionId), projectId);
  }

  async findLatestRigVersion(
    projectId: string,
    bibleId: string,
  ): Promise<CharacterRigVersion | null> {
    const rig = [...this.#rigs.values()]
      .filter(
        (candidate) =>
          candidate.projectId === projectId && candidate.bibleId === bibleId,
      )
      .sort((left, right) => right.version - left.version)[0];
    return rig ? structuredClone(rig) : null;
  }

  async findRigReviewByOperation(
    reviewerUserId: string,
    operationId: string,
  ): Promise<CharacterRigReview | null> {
    const review = [...this.#rigReviews.values()].find(
      (candidate) =>
        candidate.reviewerUserId === reviewerUserId &&
        candidate.operationId === operationId,
    );
    return review ? structuredClone(review) : null;
  }

  async commitRigReview(
    review: CharacterRigReview,
    updatedRig: CharacterRigVersion,
  ): Promise<boolean> {
    const current = this.#rigs.get(review.rigVersionId);
    const operationConflict = [...this.#rigReviews.values()].some(
      (candidate) =>
        candidate.reviewerUserId === review.reviewerUserId &&
        candidate.operationId === review.operationId,
    );
    if (
      !current ||
      current.projectId !== review.projectId ||
      current.status !== "needs-review" ||
      updatedRig.id !== current.id ||
      updatedRig.projectId !== current.projectId ||
      !["approved", "retired"].includes(updatedRig.status) ||
      operationConflict
    ) {
      return false;
    }
    this.#rigReviews.set(review.id, structuredClone(review));
    this.#rigs.set(updatedRig.id, structuredClone(updatedRig));
    return true;
  }

  async saveRigVersion(rig: CharacterRigVersion): Promise<boolean> {
    if (!this.relatedBibleExists(rig.projectId, rig.bibleId)) {
      throw new Error("Rig must reference a bible in the same project.");
    }
    const versionConflict = [...this.#rigs.values()].some(
      (candidate) =>
        candidate.id !== rig.id &&
        candidate.projectId === rig.projectId &&
        candidate.version === rig.version,
    );
    if (versionConflict) return false;
    this.#rigs.set(rig.id, structuredClone(rig));
    return true;
  }

  private relatedBibleExists(projectId: string, bibleId: string): boolean {
    return this.#bibles.get(bibleId)?.projectId === projectId;
  }
}

function cloneWhenProjectMatches<T extends { projectId: string }>(
  value: T | undefined,
  projectId: string,
): T | null {
  return value?.projectId === projectId ? structuredClone(value) : null;
}
