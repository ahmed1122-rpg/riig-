import type {
  LayerDocument,
  ProcessingJob,
} from "@motionprep/contracts";
import {
  boundedJobListLimit,
  compareJobsByUpdatedAt,
  isBeforeJobCursor,
  type JobListCursor,
} from "../jobs/job-list-cursor.js";

export interface ProcessingStatusSummary {
  total: number;
  active: number;
  failed: number;
}

export interface ProcessingJobRepository {
  findById(id: string): Promise<ProcessingJob | null>;
  list(limit: number): Promise<ProcessingJob[]>;
  listByProjectIds(
    projectIds: string[],
    limit: number,
    cursor?: JobListCursor,
  ): Promise<ProcessingJob[]>;
  summarizeStatuses(): Promise<ProcessingStatusSummary>;
  findBySource(
    projectId: string,
    sourceVersionId: string,
  ): Promise<ProcessingJob | null>;
  enqueue(
    job: ProcessingJob,
    activateProject?: () => Promise<boolean>,
  ): Promise<boolean>;
  save(job: ProcessingJob): Promise<void>;
  retryFailed(
    id: string,
    retriedAt: string,
    activateProject?: (job: ProcessingJob) => Promise<boolean>,
  ): Promise<ProcessingJob | null>;
}

export interface LayerDocumentRepository {
  /**
   * True when a successful document write also invalidates the matching
   * project review inside the same durable transaction.
   */
  readonly settlesProjectReviewAtomically?: boolean;
  findBySource(
    projectId: string,
    sourceVersionId: string,
  ): Promise<LayerDocument | null>;
  findLatestByProject(projectId: string): Promise<LayerDocument | null>;
  findRevision(
    projectId: string,
    sourceVersionId: string,
    revision: number,
  ): Promise<LayerDocument | null>;
  save(document: LayerDocument): Promise<void>;
  saveIfRevision(
    document: LayerDocument,
    expectedRevision: number,
  ): Promise<boolean>;
}

export class InMemoryProcessingJobRepository
  implements ProcessingJobRepository
{
  readonly #jobs = new Map<string, ProcessingJob>();

  async findById(id: string): Promise<ProcessingJob | null> {
    return this.#jobs.get(id) ?? null;
  }

  async list(limit: number): Promise<ProcessingJob[]> {
    return [...this.#jobs.values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, boundedJobListLimit(limit));
  }

  async listByProjectIds(
    projectIds: string[],
    limit: number,
    cursor?: JobListCursor,
  ): Promise<ProcessingJob[]> {
    const allowed = new Set(projectIds);
    return [...this.#jobs.values()]
      .filter(
        (job) =>
          allowed.has(job.projectId) &&
          (!cursor || isBeforeJobCursor(job, cursor, "processing:")),
      )
      .sort(compareJobsByUpdatedAt)
      .slice(0, boundedJobListLimit(limit));
  }

  async summarizeStatuses(): Promise<ProcessingStatusSummary> {
    const jobs = [...this.#jobs.values()];
    return {
      total: jobs.length,
      active: jobs.filter((job) =>
        ["queued", "processing", "verifying"].includes(job.status),
      ).length,
      failed: jobs.filter((job) => job.status === "failed").length,
    };
  }

  async findBySource(
    projectId: string,
    sourceVersionId: string,
  ): Promise<ProcessingJob | null> {
    return (
      [...this.#jobs.values()].find(
        (job) =>
          job.projectId === projectId &&
          job.sourceVersionId === sourceVersionId &&
          ["queued", "processing", "verifying"].includes(job.status),
      ) ?? null
    );
  }

  async save(job: ProcessingJob): Promise<void> {
    this.#jobs.set(job.id, job);
  }

  async enqueue(
    job: ProcessingJob,
    activateProject?: () => Promise<boolean>,
  ): Promise<boolean> {
    if (this.#jobs.has(job.id)) return false;
    if (activateProject && !(await activateProject())) return false;
    this.#jobs.set(job.id, job);
    return true;
  }

  async retryFailed(
    id: string,
    retriedAt: string,
    activateProject?: (job: ProcessingJob) => Promise<boolean>,
  ): Promise<ProcessingJob | null> {
    const job = this.#jobs.get(id);
    if (!job || job.status !== "failed") return null;
    const retried: ProcessingJob = {
      ...job,
      status: "queued",
      progress: 0,
      attempt: 0,
      nextAttemptAt: retriedAt,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      updatedAt: retriedAt,
    };
    if (activateProject && !(await activateProject(job))) return null;
    this.#jobs.set(id, retried);
    return retried;
  }
}

export class InMemoryLayerDocumentRepository
  implements LayerDocumentRepository
{
  readonly settlesProjectReviewAtomically = false;
  readonly #documents = new Map<string, LayerDocument>();
  readonly #revisions = new Map<string, LayerDocument>();

  async findBySource(
    projectId: string,
    sourceVersionId: string,
  ): Promise<LayerDocument | null> {
    return this.#documents.get(`${projectId}:${sourceVersionId}`) ?? null;
  }

  async findLatestByProject(projectId: string): Promise<LayerDocument | null> {
    return (
      [...this.#documents.values()]
        .filter((document) => document.projectId === projectId)
        .sort((left, right) =>
          (right.generatedAt ?? "").localeCompare(left.generatedAt ?? ""),
        )[0] ?? null
    );
  }

  async findRevision(
    projectId: string,
    sourceVersionId: string,
    revision: number,
  ): Promise<LayerDocument | null> {
    return structuredClone(
      this.#revisions.get(`${projectId}:${sourceVersionId}:${revision}`) ??
        null,
    );
  }

  async save(document: LayerDocument): Promise<void> {
    if (!document.sourceVersionId) {
      throw new Error("LayerDocument requires sourceVersionId for persistence.");
    }
    this.#documents.set(
      `${document.projectId}:${document.sourceVersionId}`,
      structuredClone(document),
    );
    this.storeRevision(document);
  }

  async saveIfRevision(
    document: LayerDocument,
    expectedRevision: number,
  ): Promise<boolean> {
    if (!document.sourceVersionId) {
      throw new Error("LayerDocument requires sourceVersionId for persistence.");
    }
    const key = `${document.projectId}:${document.sourceVersionId}`;
    const current = this.#documents.get(key);
    if (!current || (current.revision ?? 1) !== expectedRevision) {
      return false;
    }
    this.storeRevision(current);
    this.#documents.set(key, structuredClone(document));
    this.storeRevision(document);
    return true;
  }


  private storeRevision(document: LayerDocument): void {
    if (!document.sourceVersionId) return;
    const revision = document.revision ?? 1;
    const retained = new Set([
      ...(document.editTimeline?.entries.map((entry) => entry.revision) ?? []),
      ...(document.editTimeline?.navigationEntries?.map(
        (entry) => entry.resultRevision,
      ) ?? []),
    ]);
    this.#revisions.set(
      `${document.projectId}:${document.sourceVersionId}:${revision}`,
      structuredClone(document),
    );
    const oldestRetained = Math.max(1, revision - 100);
    for (const key of this.#revisions.keys()) {
      const prefix = `${document.projectId}:${document.sourceVersionId}:`;
      if (!key.startsWith(prefix)) continue;
      const candidate = Number(key.slice(prefix.length));
      if (candidate < oldestRetained && !retained.has(candidate)) {
        this.#revisions.delete(key);
      }
    }
  }
}
