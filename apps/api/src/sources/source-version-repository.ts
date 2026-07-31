import type {
  SourceType,
  SourceVersionStatus,
  SourceVersionSummary,
} from "@motionprep/contracts";

export interface CreateSourceVersionInput {
  projectId: string;
  uploadId: string;
  filename: string;
  contentType: SourceType;
  sizeBytes: number;
}

export interface SourceVersionRepository {
  create(input: CreateSourceVersionInput): Promise<SourceVersionSummary>;
  findById(id: string): Promise<SourceVersionSummary | null>;
  listByProject(projectId: string): Promise<SourceVersionSummary[]>;
  update(
    id: string,
    changes: {
      status?: SourceVersionStatus;
      sha256?: string | null;
    },
  ): Promise<SourceVersionSummary | null>;
}

export class InMemorySourceVersionRepository
  implements SourceVersionRepository
{
  readonly #versions = new Map<string, SourceVersionSummary>();

  async create(
    input: CreateSourceVersionInput,
  ): Promise<SourceVersionSummary> {
    const now = new Date().toISOString();
    const versionNumber =
      Math.max(
        0,
        ...[...this.#versions.values()]
          .filter((version) => version.projectId === input.projectId)
          .map((version) => version.versionNumber),
      ) + 1;
    const version: SourceVersionSummary = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      uploadId: input.uploadId,
      versionNumber,
      filename: input.filename,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      status: "uploading",
      sha256: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#versions.set(version.id, version);
    return version;
  }

  async findById(id: string): Promise<SourceVersionSummary | null> {
    return this.#versions.get(id) ?? null;
  }

  async listByProject(projectId: string): Promise<SourceVersionSummary[]> {
    return [...this.#versions.values()]
      .filter((version) => version.projectId === projectId)
      .sort((left, right) => right.versionNumber - left.versionNumber);
  }

  async update(
    id: string,
    changes: {
      status?: SourceVersionStatus;
      sha256?: string | null;
    },
  ): Promise<SourceVersionSummary | null> {
    const current = this.#versions.get(id);
    if (!current) return null;
    const updated: SourceVersionSummary = {
      ...current,
      ...changes,
      updatedAt: new Date().toISOString(),
    };
    this.#versions.set(id, updated);
    return updated;
  }
}
