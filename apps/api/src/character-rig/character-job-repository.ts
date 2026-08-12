import type { CharacterJob } from "@motionprep/contracts";

export interface CharacterJobRepository {
  findById(id: string): Promise<CharacterJob | null>;
  findByOperationKey(
    projectId: string,
    operationKey: string,
  ): Promise<CharacterJob | null>;
  save(job: CharacterJob): Promise<void>;
  claimNext(
    workerId: string,
    claimedAt: string,
    leaseExpiresAt: string,
  ): Promise<CharacterJob | null>;
  renewClaim(
    id: string,
    workerId: string,
    renewedAt: string,
    leaseExpiresAt: string,
  ): Promise<boolean>;
  completeClaim(
    id: string,
    workerId: string,
    completedAt: string,
  ): Promise<CharacterJob | null>;
  retryOrFailClaim(
    id: string,
    workerId: string,
    errorCode: string,
    nextAttemptAt: string,
    updatedAt: string,
  ): Promise<CharacterJob | null>;
}

export class InMemoryCharacterJobRepository implements CharacterJobRepository {
  readonly #jobs = new Map<string, CharacterJob>();

  async findById(id: string): Promise<CharacterJob | null> {
    const job = this.#jobs.get(id);
    return job ? structuredClone(job) : null;
  }

  async findByOperationKey(
    projectId: string,
    operationKey: string,
  ): Promise<CharacterJob | null> {
    const job = [...this.#jobs.values()].find(
      (candidate) =>
        candidate.projectId === projectId &&
        candidate.operationKey === operationKey,
    );
    return job ? structuredClone(job) : null;
  }

  async save(job: CharacterJob): Promise<void> {
    const conflict = [...this.#jobs.values()].some(
      (candidate) =>
        candidate.id !== job.id &&
        candidate.projectId === job.projectId &&
        candidate.operationKey === job.operationKey,
    );
    if (conflict) throw new Error("Character job operation key already exists.");
    this.#jobs.set(job.id, structuredClone(job));
  }

  async claimNext(
    workerId: string,
    claimedAt: string,
    leaseExpiresAt: string,
  ): Promise<CharacterJob | null> {
    const job = [...this.#jobs.values()]
      .filter(
        (candidate) =>
          candidate.attempt < candidate.maxAttempts &&
          ((candidate.status === "queued" &&
            candidate.nextAttemptAt <= claimedAt) ||
            (["processing", "verifying"].includes(candidate.status) &&
              candidate.leaseExpiresAt !== null &&
              candidate.leaseExpiresAt <= claimedAt)),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!job) return null;
    const claimed: CharacterJob = {
      ...job,
      status: "processing",
      attempt: job.attempt + 1,
      leaseOwner: workerId,
      leaseExpiresAt,
      errorCode: null,
      updatedAt: claimedAt,
    };
    this.#jobs.set(job.id, claimed);
    return structuredClone(claimed);
  }

  async renewClaim(
    id: string,
    workerId: string,
    renewedAt: string,
    leaseExpiresAt: string,
  ): Promise<boolean> {
    const job = this.#jobs.get(id);
    if (
      !job ||
      job.leaseOwner !== workerId ||
      !["processing", "verifying"].includes(job.status) ||
      job.leaseExpiresAt === null ||
      job.leaseExpiresAt <= renewedAt
    ) {
      return false;
    }
    this.#jobs.set(id, { ...job, leaseExpiresAt, updatedAt: renewedAt });
    return true;
  }

  async completeClaim(
    id: string,
    workerId: string,
    completedAt: string,
  ): Promise<CharacterJob | null> {
    const job = this.#jobs.get(id);
    if (
      !job ||
      job.leaseOwner !== workerId ||
      job.leaseExpiresAt === null ||
      job.leaseExpiresAt <= completedAt ||
      !["processing", "verifying"].includes(job.status)
    ) {
      return null;
    }
    const completed: CharacterJob = {
      ...job,
      status: "succeeded",
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      updatedAt: completedAt,
    };
    this.#jobs.set(id, completed);
    return structuredClone(completed);
  }

  async retryOrFailClaim(
    id: string,
    workerId: string,
    errorCode: string,
    nextAttemptAt: string,
    updatedAt: string,
  ): Promise<CharacterJob | null> {
    const job = this.#jobs.get(id);
    if (!job || job.leaseOwner !== workerId) return null;
    const terminal = job.attempt >= job.maxAttempts;
    const updated: CharacterJob = {
      ...job,
      status: terminal ? "failed" : "queued",
      nextAttemptAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode,
      updatedAt,
    };
    this.#jobs.set(id, updated);
    return structuredClone(updated);
  }
}
