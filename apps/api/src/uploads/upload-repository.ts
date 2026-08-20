import type {
  ProjectStatus,
  UploadSession,
} from "@motionprep/contracts";

export interface SaveUploadOptions {
  projectStatusBeforeUpload?: ProjectStatus;
}

export interface UploadStatusSummary {
  total: number;
  active: number;
  failed: number;
}

export interface UploadRepository {
  findById(id: string): Promise<UploadSession | null>;
  findActiveByProject(projectId: string): Promise<UploadSession | null>;
  findReadyBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<UploadSession | null>;
  findExpiredActiveByProject(
    projectId: string,
    expiredAt: string,
  ): Promise<UploadSession[]>;
  findProjectStatusBeforeUpload(
    uploadId: string,
  ): Promise<ProjectStatus | null>;
  markObjectPurged(uploadId: string, purgedAt: string): Promise<void>;
  list(): Promise<UploadSession[]>;
  summarizeStatuses(): Promise<UploadStatusSummary>;
  save(session: UploadSession, options?: SaveUploadOptions): Promise<void>;
}

const activeStatuses = new Set<UploadSession["status"]>([
  "validating",
  "uploading",
  "verifying",
  "scanning",
]);

export class InMemoryUploadRepository implements UploadRepository {
  readonly #sessions = new Map<string, UploadSession>();
  readonly #projectStatusesBeforeUpload = new Map<string, ProjectStatus>();

  async findById(id: string): Promise<UploadSession | null> {
    return this.#sessions.get(id) ?? null;
  }

  async findActiveByProject(projectId: string): Promise<UploadSession | null> {
    return (
      [...this.#sessions.values()].find(
        (session) =>
          session.projectId === projectId &&
          activeStatuses.has(session.status),
      ) ?? null
    );
  }

  async findReadyBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<UploadSession | null> {
    return (
      [...this.#sessions.values()].find(
        (session) =>
          session.projectId === projectId &&
          session.status === "ready" &&
          (session.malwareScanVerdict === undefined ||
            session.malwareScanVerdict === "clean") &&
          session.sourceVersionId === sourceVersionId,
      ) ?? null
    );
  }

  async findExpiredActiveByProject(
    projectId: string,
    expiredAt: string,
  ): Promise<UploadSession[]> {
    return [...this.#sessions.values()].filter(
      (session) =>
        session.projectId === projectId &&
        activeStatuses.has(session.status) &&
        session.expiresAt <= expiredAt,
    );
  }

  async findProjectStatusBeforeUpload(
    uploadId: string,
  ): Promise<ProjectStatus | null> {
    return this.#projectStatusesBeforeUpload.get(uploadId) ?? null;
  }

  async list(): Promise<UploadSession[]> {
    return [...this.#sessions.values()];
  }

  async summarizeStatuses(): Promise<UploadStatusSummary> {
    const sessions = [...this.#sessions.values()];
    return {
      total: sessions.length,
      active: sessions.filter((session) => activeStatuses.has(session.status))
        .length,
      failed: sessions.filter((session) =>
        ["failed", "rejected", "scan_failed"].includes(session.status),
      ).length,
    };
  }

  async markObjectPurged(_uploadId: string, _purgedAt: string): Promise<void> {
    // In-memory object storage is process-local; no durable purge marker is
    // required, but the method preserves the production repository contract.
  }

  async save(
    session: UploadSession,
    options: SaveUploadOptions = {},
  ): Promise<void> {
    this.#sessions.set(session.uploadId, session);
    if (
      options.projectStatusBeforeUpload !== undefined &&
      !this.#projectStatusesBeforeUpload.has(session.uploadId)
    ) {
      this.#projectStatusesBeforeUpload.set(
        session.uploadId,
        options.projectStatusBeforeUpload,
      );
    }
  }
}
