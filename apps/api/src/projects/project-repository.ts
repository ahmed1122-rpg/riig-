import type {
  CreateProjectInput,
  ProjectSummary,
} from "@motionprep/contracts";

export interface ProjectRepository {
  create(ownerUserId: string, input: CreateProjectInput): Promise<ProjectSummary>;
  findOwnedById(
    ownerUserId: string,
    id: string,
  ): Promise<ProjectSummary | null>;
  listOwnedByUser(ownerUserId: string): Promise<ProjectSummary[]>;
  updateStatus(
    id: string,
    status: ProjectSummary["status"],
  ): Promise<ProjectSummary | null>;
  updateCurrentSourceVersion(
    id: string,
    sourceVersionId: string,
    versionNumber: number,
  ): Promise<ProjectSummary | null>;
}

interface ProjectRecord extends ProjectSummary {
  ownerUserId: string;
}

export class InMemoryProjectRepository implements ProjectRepository {
  readonly #projects = new Map<string, ProjectRecord>();

  async create(
    ownerUserId: string,
    input: CreateProjectInput,
  ): Promise<ProjectSummary> {
    const now = new Date().toISOString();
    const project: ProjectRecord = {
      id: crypto.randomUUID(),
      ownerUserId,
      name: input.name,
      kind: input.kind,
      status: "draft",
      currentSourceVersionId: null,
      currentSourceVersionNumber: null,
      createdAt: now,
      updatedAt: now,
    };

    this.#projects.set(project.id, project);
    return this.toSummary(project);
  }

  async findOwnedById(
    ownerUserId: string,
    id: string,
  ): Promise<ProjectSummary | null> {
    const project = this.#projects.get(id);
    return project?.ownerUserId === ownerUserId
      ? this.toSummary(project)
      : null;
  }

  async listOwnedByUser(ownerUserId: string): Promise<ProjectSummary[]> {
    return [...this.#projects.values()]
      .filter((project) => project.ownerUserId === ownerUserId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((project) => this.toSummary(project));
  }

  async updateStatus(
    id: string,
    status: ProjectSummary["status"],
  ): Promise<ProjectSummary | null> {
    const project = this.#projects.get(id);
    if (!project) return null;
    const updated = {
      ...project,
      status,
      updatedAt: new Date().toISOString(),
    };
    this.#projects.set(id, updated);
    return this.toSummary(updated);
  }

  async updateCurrentSourceVersion(
    id: string,
    sourceVersionId: string,
    versionNumber: number,
  ): Promise<ProjectSummary | null> {
    const project = this.#projects.get(id);
    if (!project) return null;
    const updated: ProjectRecord = {
      ...project,
      currentSourceVersionId: sourceVersionId,
      currentSourceVersionNumber: versionNumber,
      updatedAt: new Date().toISOString(),
    };
    this.#projects.set(id, updated);
    return this.toSummary(updated);
  }

  private toSummary(project: ProjectRecord): ProjectSummary {
    const { ownerUserId: _ownerUserId, ...summary } = project;
    return summary;
  }
}
