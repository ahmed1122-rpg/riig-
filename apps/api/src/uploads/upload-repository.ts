import type { UploadSession } from "@motionprep/contracts";

export interface UploadRepository {
  findById(id: string): Promise<UploadSession | null>;
  findActiveByProject(projectId: string): Promise<UploadSession | null>;
  findReadyBySourceVersion(
    projectId: string,
    sourceVersionId: string,
  ): Promise<UploadSession | null>;
  expireActiveByProject(
    projectId: string,
    expiredAt: string,
  ): Promise<UploadSession[]>;
  list(): Promise<UploadSession[]>;
  save(session: UploadSession): Promise<void>;
}

const activeStatuses = new Set<UploadSession["status"]>([
  "validating",
  "uploading",
  "verifying",
]);

export class InMemoryUploadRepository implements UploadRepository {
  readonly #sessions = new Map<string, UploadSession>();

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
          session.sourceVersionId === sourceVersionId,
      ) ?? null
    );
  }

  async expireActiveByProject(
    projectId: string,
    expiredAt: string,
  ): Promise<UploadSession[]> {
    const expired: UploadSession[] = [];
    for (const session of this.#sessions.values()) {
      if (
        session.projectId !== projectId ||
        !activeStatuses.has(session.status) ||
        session.expiresAt > expiredAt
      ) {
        continue;
      }
      const cancelled: UploadSession = {
        ...session,
        status: "cancelled",
        updatedAt: expiredAt,
      };
      this.#sessions.set(session.uploadId, cancelled);
      expired.push(cancelled);
    }
    return expired;
  }

  async list(): Promise<UploadSession[]> {
    return [...this.#sessions.values()];
  }

  async save(session: UploadSession): Promise<void> {
    this.#sessions.set(session.uploadId, session);
  }
}
