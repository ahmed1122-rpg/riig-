import type {
  ExportJob,
  ProcessingJob,
  ProjectSummary,
  WorkflowActivityFeed,
  WorkflowActivityItem,
  WorkflowActivityStatus,
} from "@motionprep/contracts";
import type { ExportRepository } from "../exports/export-repository.js";
import {
  isBeforeJobCursor,
  type JobListCursor,
} from "../jobs/job-list-cursor.js";
import type { ProcessingJobRepository } from "../processing/processing-repository.js";
import type { ProjectRepository } from "../projects/project-repository.js";

const DEFAULT_ACTIVITY_LIMIT = 12;
const MAX_ACTIVITY_LIMIT = 50;

export class ActivityDomainError extends Error {
  constructor(
    readonly code: "ACTIVITY_CURSOR_INVALID",
    message: string,
  ) {
    super(message);
  }
}

export interface ActivityFeedQuery {
  limit?: number;
  cursor?: string;
}

export class ActivityService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly processingJobs: ProcessingJobRepository,
    private readonly exports: ExportRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listOwnedByUser(
    ownerUserId: string,
    query: ActivityFeedQuery = {},
  ): Promise<WorkflowActivityFeed> {
    const limit = normalizeLimit(query.limit);
    const cursor = query.cursor ? decodeActivityCursor(query.cursor) : undefined;
    const projects = await this.projects.listOwnedByUser(ownerUserId);
    const projectIds = projects.map((project) => project.id);
    const projectById = new Map(
      projects.map((project) => [project.id, project] as const),
    );

    const [processingJobs, exportJobs] = await Promise.all([
      this.processingJobs.listByProjectIds(projectIds, limit + 1, cursor),
      this.exports.listByProjectIds(projectIds, limit + 1, cursor),
    ]);
    const terminalJobsByProject = new Set(
      [...processingJobs, ...exportJobs]
        .filter((job) => ["failed", "cancelled"].includes(job.status))
        .map((job) => job.projectId),
    );

    const candidates = [
      ...projects.flatMap((project) => {
        const item = projectActivity(project, terminalJobsByProject);
        if (!item || (cursor && !isBeforeJobCursor(item, cursor))) return [];
        return [item];
      }),
      ...processingJobs.flatMap((job) => {
        const project = projectById.get(job.projectId);
        return project ? [processingActivity(job, project)] : [];
      }),
      ...exportJobs.flatMap((job) => {
        const project = projectById.get(job.projectId);
        return project ? [exportActivity(job, project)] : [];
      }),
    ].sort(compareActivities);

    const page = candidates.slice(0, limit);
    return {
      items: page,
      summary: summarizeCurrentProjects(projects),
      nextCursor:
        candidates.length > limit && page.length > 0
          ? encodeActivityCursor(page.at(-1)!)
          : null,
      generatedAt: this.now().toISOString(),
    };
  }
}

function projectActivity(
  project: ProjectSummary,
  terminalJobsByProject: ReadonlySet<string>,
): WorkflowActivityItem | null {
  const common = {
    id: `project:${project.id}`,
    project: {
      id: project.id,
      name: project.name,
      kind: project.kind,
    },
    sourceVersionId: project.currentSourceVersionId,
    jobId: null,
    errorCode: null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  } as const;

  switch (project.status) {
    case "draft":
      return {
        ...common,
        kind: "upload",
        status: "pending",
        progress: 0,
        recommendedAction: "open-project",
      };
    case "validating":
    case "uploading":
      return {
        ...common,
        kind: "upload",
        status: "running",
        progress: null,
        recommendedAction: "open-project",
      };
    case "needs_review":
      return {
        ...common,
        kind: "review",
        status: "attention",
        progress: 100,
        recommendedAction: "review-project",
      };
    case "approved":
    case "completed":
      return {
        ...common,
        kind: "review",
        status: "succeeded",
        progress: 100,
        recommendedAction: "open-project",
      };
    case "failed":
      if (terminalJobsByProject.has(project.id)) return null;
      return {
        ...common,
        kind: project.currentSourceVersionId ? "processing" : "upload",
        status: "failed",
        progress: null,
        recommendedAction: "open-project",
      };
    case "cancelled":
      if (terminalJobsByProject.has(project.id)) return null;
      return {
        ...common,
        kind: project.currentSourceVersionId ? "processing" : "upload",
        status: "cancelled",
        progress: null,
        recommendedAction: "open-project",
      };
    case "queued":
    case "processing":
    case "exporting":
      return null;
  }
}

function processingActivity(
  job: ProcessingJob,
  project: ProjectSummary,
): WorkflowActivityItem {
  return {
    id: `processing:${job.id}`,
    kind: "processing",
    status: processingStatus(job.status),
    project: { id: project.id, name: project.name, kind: project.kind },
    sourceVersionId: job.sourceVersionId,
    jobId: job.id,
    progress: job.progress,
    errorCode: job.errorCode,
    recommendedAction: "open-project",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function exportActivity(
  job: ExportJob,
  project: ProjectSummary,
): WorkflowActivityItem {
  return {
    id: `export:${job.id}`,
    kind: "export",
    status: exportStatus(job.status),
    project: { id: project.id, name: project.name, kind: project.kind },
    sourceVersionId: job.sourceVersionId,
    jobId: job.id,
    progress: job.progress,
    errorCode: job.errorCode,
    recommendedAction:
      job.status === "ready" ? "view-exports" : "open-project",
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function processingStatus(status: ProcessingJob["status"]): WorkflowActivityStatus {
  if (status === "queued") return "pending";
  if (status === "processing" || status === "verifying") return "running";
  if (status === "ready") return "succeeded";
  return status;
}

function exportStatus(status: ExportJob["status"]): WorkflowActivityStatus {
  if (status === "queued") return "pending";
  if (status === "generating" || status === "verifying") return "running";
  if (status === "ready") return "succeeded";
  return status;
}

function summarizeCurrentProjects(projects: ProjectSummary[]) {
  return {
    active: projects.filter((project) =>
      ["validating", "uploading", "queued", "processing", "exporting"].includes(
        project.status,
      ),
    ).length,
    needsAttention: projects.filter(
      (project) => project.status === "needs_review",
    ).length,
    failed: projects.filter((project) => project.status === "failed").length,
  };
}

function compareActivities(
  left: Pick<WorkflowActivityItem, "updatedAt" | "id">,
  right: Pick<WorkflowActivityItem, "updatedAt" | "id">,
): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    right.id.localeCompare(left.id)
  );
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_ACTIVITY_LIMIT;
  return Math.max(1, Math.min(Math.trunc(limit), MAX_ACTIVITY_LIMIT));
}

function encodeActivityCursor(
  item: Pick<WorkflowActivityItem, "updatedAt" | "id">,
): string {
  return Buffer.from(
    JSON.stringify({ updatedAt: item.updatedAt, id: item.id }),
  ).toString("base64url");
}

function decodeActivityCursor(value: string): JobListCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      updatedAt?: unknown;
      id?: unknown;
    };
    if (
      typeof parsed.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(parsed.updatedAt)) ||
      typeof parsed.id !== "string" ||
      !/^(?:project|processing|export):[\w-]+$/u.test(parsed.id)
    ) {
      throw new Error("invalid cursor fields");
    }
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    throw new ActivityDomainError(
      "ACTIVITY_CURSOR_INVALID",
      "مؤشر صفحة النشاط غير صالح. حدّث الصفحة ثم أعد المحاولة.",
    );
  }
}
