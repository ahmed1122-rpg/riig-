import type { ExportJob } from "@motionprep/contracts";
import {
  boundedJobListLimit,
  compareJobsByUpdatedAt,
  isBeforeJobCursor,
  type JobListCursor,
} from "../jobs/job-list-cursor.js";

export interface ExportStatusSummary {
  total: number;
  queued: number;
  failed: number;
}

export interface ExportRepository {
  findById(id: string): Promise<ExportJob | null>;
  list(limit: number): Promise<ExportJob[]>;
  listByProjectIds(
    projectIds: string[],
    limit: number,
    cursor?: JobListCursor,
  ): Promise<ExportJob[]>;
  summarizeStatuses(): Promise<ExportStatusSummary>;
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
  retryFailed(id: string, retriedAt: string): Promise<ExportJob | null>;
  requestCancel(id: string, updatedAt: string): Promise<ExportJob | null>;
}

export class InMemoryExportRepository implements ExportRepository {
  readonly #jobs = new Map<string, ExportJob>();

  async findById(id: string): Promise<ExportJob | null> {
    return this.#jobs.get(id) ?? null;
  }

  async list(limit: number): Promise<ExportJob[]> {
    return [...this.#jobs.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, boundedListLimit(limit));
  }

  async listByProjectIds(
    projectIds: string[],
    limit: number,
    cursor?: JobListCursor,
  ): Promise<ExportJob[]> {
    const allowed = new Set(projectIds);
    return [...this.#jobs.values()]
      .filter(
        (job) =>
          allowed.has(job.projectId) &&
          (!cursor || isBeforeJobCursor(job, cursor, "export:")),
      )
      .sort(compareJobsByUpdatedAt)
      .slice(0, boundedListLimit(limit));
  }

  async summarizeStatuses(): Promise<ExportStatusSummary> {
    const jobs = [...this.#jobs.values()];
    return {
      total: jobs.length,
      queued: jobs.filter((job) => job.status === "queued").length,
      failed: jobs.filter((job) => job.status === "failed").length,
    };
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

  async retryFailed(
    id: string,
    retriedAt: string,
  ): Promise<ExportJob | null> {
    const job = this.#jobs.get(id);
    if (!job || job.status !== "failed") return null;
    const { artifact: _artifact, ...withoutArtifact } = job;
    const retried: ExportJob = {
      ...withoutArtifact,
      status: "queued",
      progress: 0,
      attempt: 0,
      nextAttemptAt: retriedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      updatedAt: retriedAt,
    };
    this.#jobs.set(id, retried);
    return retried;
  }

  async requestCancel(
    id: string,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const job = this.#jobs.get(id);
    if (!job) return null;
    if (!["queued", "generating"].includes(job.status)) {
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

function boundedListLimit(limit: number): number {
  return boundedJobListLimit(limit);
}
