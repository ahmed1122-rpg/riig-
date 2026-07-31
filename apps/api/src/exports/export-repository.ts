import type { ExportJob } from "@motionprep/contracts";

export interface ExportRepository {
  findById(id: string): Promise<ExportJob | null>;
  list(): Promise<ExportJob[]>;
  listByProjectIds(projectIds: string[]): Promise<ExportJob[]>;
  save(job: ExportJob): Promise<void>;
  claimNext(
    workerId: string,
    claimedAt: string,
    leaseExpiresAt: string,
  ): Promise<ExportJob | null>;
  updateClaim(
    id: string,
    workerId: string,
    changes: Partial<ExportJob>,
    updatedAt: string,
  ): Promise<ExportJob | null>;
  retryOrFailClaim(
    id: string,
    workerId: string,
    errorCode: string,
    nextAttemptAt: string,
    updatedAt: string,
  ): Promise<ExportJob | null>;
  requestCancel(id: string, updatedAt: string): Promise<ExportJob | null>;
}

export class InMemoryExportRepository implements ExportRepository {
  readonly #jobs = new Map<string, ExportJob>();

  async findById(id: string): Promise<ExportJob | null> {
    return this.#jobs.get(id) ?? null;
  }

  async list(): Promise<ExportJob[]> {
    return [...this.#jobs.values()];
  }

  async listByProjectIds(projectIds: string[]): Promise<ExportJob[]> {
    const allowed = new Set(projectIds);
    return [...this.#jobs.values()]
      .filter((job) => allowed.has(job.projectId))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async save(job: ExportJob): Promise<void> {
    this.#jobs.set(job.id, job);
  }

  async claimNext(
    workerId: string,
    claimedAt: string,
    leaseExpiresAt: string,
  ): Promise<ExportJob | null> {
    const job = [...this.#jobs.values()]
      .filter(
        (candidate) =>
          candidate.attempt < candidate.maxAttempts &&
          ((candidate.status === "queued" &&
            candidate.nextAttemptAt <= claimedAt) ||
            (["generating", "verifying"].includes(candidate.status) &&
              Boolean(candidate.leaseExpiresAt) &&
              candidate.leaseExpiresAt! <= claimedAt)),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!job) return null;
    const claimed: ExportJob = {
      ...job,
      status: "generating",
      progress: Math.max(job.progress, 10),
      attempt: job.attempt + 1,
      leaseOwner: workerId,
      leaseExpiresAt,
      errorCode: null,
      updatedAt: claimedAt,
    };
    this.#jobs.set(job.id, claimed);
    return claimed;
  }

  async updateClaim(
    id: string,
    workerId: string,
    changes: Partial<ExportJob>,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const job = this.#jobs.get(id);
    if (
      !job ||
      job.leaseOwner !== workerId ||
      job.status === "cancelled" ||
      (job.leaseExpiresAt !== null && job.leaseExpiresAt <= updatedAt)
    ) {
      return null;
    }
    const updated: ExportJob = {
      ...job,
      ...changes,
      updatedAt,
    };
    this.#jobs.set(id, updated);
    return updated;
  }

  async retryOrFailClaim(
    id: string,
    workerId: string,
    errorCode: string,
    nextAttemptAt: string,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const job = this.#jobs.get(id);
    if (!job || job.leaseOwner !== workerId || job.status === "cancelled") {
      return null;
    }
    const terminal = job.attempt >= job.maxAttempts;
    const updated: ExportJob = {
      ...job,
      status: terminal ? "failed" : "queued",
      progress: terminal ? job.progress : 0,
      nextAttemptAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode,
      updatedAt,
    };
    this.#jobs.set(id, updated);
    return updated;
  }

  async requestCancel(
    id: string,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const job = this.#jobs.get(id);
    if (!job) return null;
    if (!["preflight", "queued", "generating"].includes(job.status)) {
      return job;
    }
    const cancelled: ExportJob = {
      ...job,
      status: "cancelled",
      leaseOwner: null,
      leaseExpiresAt: null,
      updatedAt,
    };
    this.#jobs.set(id, cancelled);
    return cancelled;
  }
}
