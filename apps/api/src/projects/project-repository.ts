import type {
  CreateProjectInput,
  ProjectReviewApproval,
  ProjectSummary,
} from "@motionprep/contracts";

export type ProjectJobType = "processing" | "export";

export interface ActiveProjectJob {
  type: ProjectJobType;
  id: string;
}

export interface ProjectRepository {
  create(ownerUserId: string, input: CreateProjectInput): Promise<ProjectSummary>;
  findById(id: string): Promise<ProjectSummary | null>;
  hasActiveJob(id: string): Promise<boolean>;
  findOwnedById(
    ownerUserId: string,
    id: string,
  ): Promise<ProjectSummary | null>;
  listOwnedByUser(ownerUserId: string): Promise<ProjectSummary[]>;
  deleteEmptyDraft(ownerUserId: string, id: string): Promise<boolean>;
  updateStatus(
    id: string,
    status: ProjectSummary["status"],
  ): Promise<ProjectSummary | null>;
  updateStatusForSource(
    id: string,
    sourceVersionId: string,
    status: ProjectSummary["status"],
    activeJob: ActiveProjectJob | null,
  ): Promise<ProjectSummary | null>;
  applyReviewApproval(
    approval: ProjectReviewApproval,
  ): Promise<ProjectSummary | null>;
  findCurrentReviewApproval(id: string): Promise<ProjectReviewApproval | null>;
  invalidateReview(
    id: string,
    sourceVersionId: string,
  ): Promise<ProjectSummary | null>;
  finishJobStatus(
    id: string,
    sourceVersionId: string,
    activeJob: ActiveProjectJob,
    status: ProjectSummary["status"],
    documentRevision?: number,
  ): Promise<ProjectSummary | null>;
  updateCurrentSourceVersion(
    id: string,
    sourceVersionId: string,
    versionNumber: number,
    requireIdle?: boolean,
  ): Promise<ProjectSummary | null>;
  settleUploadCancellation(
    id: string,
    cancelledSourceVersionId: string,
    status: ProjectSummary["status"],
  ): Promise<ProjectSummary | null>;
}

interface ProjectRecord extends ProjectSummary {
  ownerUserId: string;
  activeJobType: ProjectJobType | null;
  activeJobId: string | null;
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
      reviewApproval: null,
      activeJobType: null,
      activeJobId: null,
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

  async findById(id: string): Promise<ProjectSummary | null> {
    const project = this.#projects.get(id);
    return project ? this.toSummary(project) : null;
  }

  async hasActiveJob(id: string): Promise<boolean> {
    return (this.#projects.get(id)?.activeJobId ?? null) !== null;
  }

  async listOwnedByUser(ownerUserId: string): Promise<ProjectSummary[]> {
    return [...this.#projects.values()]
      .filter((project) => project.ownerUserId === ownerUserId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((project) => this.toSummary(project));
  }

  async deleteEmptyDraft(ownerUserId: string, id: string): Promise<boolean> {
    const project = this.#projects.get(id);
    if (
      !project ||
      project.ownerUserId !== ownerUserId ||
      project.status !== "draft" ||
      project.currentSourceVersionId !== null ||
      project.activeJobId !== null
    ) {
      return false;
    }
    return this.#projects.delete(id);
  }

  async updateStatus(
    id: string,
    status: ProjectSummary["status"],
  ): Promise<ProjectSummary | null> {
    const project = this.#projects.get(id);
    if (!project || project.activeJobId !== null) return null;
    const updated = {
      ...project,
      status,
      ...(status === "needs_review" ? { reviewApproval: null } : {}),
      activeJobType: null,
      activeJobId: null,
      updatedAt: new Date().toISOString(),
    };
    this.#projects.set(id, updated);
    return this.toSummary(updated);
  }

  async updateStatusForSource(
    id: string,
    sourceVersionId: string,
    status: ProjectSummary["status"],
    activeJob: ActiveProjectJob | null,
  ): Promise<ProjectSummary | null> {
    const project = this.#projects.get(id);
    if (
      !project ||
      project.currentSourceVersionId !== sourceVersionId ||
      (activeJob !== null &&
        ["validating", "uploading"].includes(project.status)) ||
      (project.activeJobId !== null &&
        (project.activeJobType !== activeJob?.type ||
          project.activeJobId !== activeJob?.id))
    ) {
      return null;
    }
    const updated: ProjectRecord = {
      ...project,
      status,
      ...(["queued", "processing", "needs_review"].includes(status)
        ? { reviewApproval: null }
        : {}),
      activeJobType: activeJob?.type ?? null,
      activeJobId: activeJob?.id ?? null,
      updatedAt: new Date().toISOString(),
    };
    this.#projects.set(id, updated);
    return this.toSummary(updated);
  }

  async applyReviewApproval(
    approval: ProjectReviewApproval,
  ): Promise<ProjectSummary | null> {
    const project = this.#projects.get(approval.projectId);
    if (
      !project ||
      project.currentSourceVersionId !== approval.sourceVersionId ||
      project.activeJobId !== null ||
      !["needs_review", "approved", "completed"].includes(project.status)
    ) {
      return null;
    }
    const updated: ProjectRecord = {
      ...project,
      status: "approved",
      reviewApproval: structuredClone(approval),
      activeJobType: null,
      activeJobId: null,
      updatedAt: new Date().toISOString(),
    };
    this.#projects.set(approval.projectId, updated);
    return this.toSummary(updated);
  }

  async findCurrentReviewApproval(
    id: string,
  ): Promise<ProjectReviewApproval | null> {
    const approval = this.#projects.get(id)?.reviewApproval;
    return approval ? structuredClone(approval) : null;
  }

  async invalidateReview(
    id: string,
    sourceVersionId: string,
  ): Promise<ProjectSummary | null> {
    const project = this.#projects.get(id);
    if (!project || project.currentSourceVersionId !== sourceVersionId) {
      return null;
    }
    const updated: ProjectRecord = {
      ...project,
      reviewApproval: null,
      status: project.activeJobId === null ? "needs_review" : project.status,
      updatedAt: new Date().toISOString(),
    };
    this.#projects.set(id, updated);
    return this.toSummary(updated);
  }

  async finishJobStatus(
    id: string,
    sourceVersionId: string,
    activeJob: ActiveProjectJob,
    status: ProjectSummary["status"],
    documentRevision?: number,
  ): Promise<ProjectSummary | null> {
    const project = this.#projects.get(id);
    if (
      !project ||
      project.currentSourceVersionId !== sourceVersionId ||
      project.activeJobType !== activeJob.type ||
      project.activeJobId !== activeJob.id
    ) {
      return null;
    }
    const reviewStillMatches =
      activeJob.type === "export" &&
      documentRevision !== undefined &&
      project.reviewApproval?.sourceVersionId === sourceVersionId &&
      project.reviewApproval.documentRevision === documentRevision;
    const settledStatus =
      activeJob.type !== "export"
        ? status
        : reviewStillMatches
          ? status === "completed"
            ? "completed"
            : "approved"
          : "needs_review";
    const updated: ProjectRecord = {
      ...project,
      status: settledStatus,
      activeJobType: null,
      activeJobId: null,
      updatedAt: new Date().toISOString(),
    };
    this.#projects.set(id, updated);
    return this.toSummary(updated);
  }

  async updateCurrentSourceVersion(
    id: string,
    sourceVersionId: string,
    versionNumber: number,
    requireIdle = false,
  ): Promise<ProjectSummary | null> {
    const project = this.#projects.get(id);
    if (!project || (requireIdle && project.activeJobId !== null)) return null;
    const updated: ProjectRecord = {
      ...project,
      currentSourceVersionId: sourceVersionId,
      currentSourceVersionNumber: versionNumber,
      reviewApproval: null,
      activeJobType: null,
      activeJobId: null,
      updatedAt: new Date().toISOString(),
    };
    this.#projects.set(id, updated);
    return this.toSummary(updated);
  }

  async settleUploadCancellation(
    id: string,
    cancelledSourceVersionId: string,
    status: ProjectSummary["status"],
  ): Promise<ProjectSummary | null> {
    const project = this.#projects.get(id);
    if (!project || !["validating", "uploading"].includes(project.status)) {
      return null;
    }
    const cancelledWasCurrent =
      project.currentSourceVersionId === cancelledSourceVersionId;
    const updated: ProjectRecord = {
      ...project,
      status,
      ...(cancelledWasCurrent
        ? {
            currentSourceVersionId: null,
            currentSourceVersionNumber: null,
            reviewApproval: null,
          }
        : {}),
      activeJobType: null,
      activeJobId: null,
      updatedAt: new Date().toISOString(),
    };
    this.#projects.set(id, updated);
    return this.toSummary(updated);
  }

  private toSummary(project: ProjectRecord): ProjectSummary {
    const {
      ownerUserId: _ownerUserId,
      activeJobType: _activeJobType,
      activeJobId: _activeJobId,
      ...summary
    } = project;
    return summary;
  }
}
