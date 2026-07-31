import type {
  ProjectSummary,
  SourceVersionRestoreEvent,
  SourceVersionRestoreResult,
} from "@motionprep/contracts";
import type { ProjectRepository } from "../projects/project-repository.js";
import type { SourceVersionRepository } from "./source-version-repository.js";

export type SourceVersionRestoreErrorCode =
  | "PROJECT_NOT_FOUND"
  | "SOURCE_VERSION_NOT_FOUND"
  | "SOURCE_VERSION_NOT_READY"
  | "SOURCE_VERSION_CONFLICT"
  | "SOURCE_VERSION_ALREADY_CURRENT"
  | "IDEMPOTENCY_CONFLICT";

export class SourceVersionRestoreDomainError extends Error {
  constructor(
    readonly code: SourceVersionRestoreErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface RestoreSourceVersionInput {
  projectId: string;
  actorUserId: string;
  targetSourceVersionId: string;
  expectedCurrentSourceVersionId: string;
  reason: string;
  requestId: string;
}

export interface SourceVersionRestoreCommand {
  restore(input: RestoreSourceVersionInput): Promise<SourceVersionRestoreResult>;
  list(
    projectId: string,
    actorUserId: string,
    limit?: number,
  ): Promise<SourceVersionRestoreEvent[]>;
}

export class InMemorySourceVersionRestoreCommand
  implements SourceVersionRestoreCommand
{
  readonly #events: SourceVersionRestoreEvent[] = [];
  readonly #locks = new Map<string, Promise<void>>();

  constructor(
    private readonly projects: ProjectRepository,
    private readonly sourceVersions: SourceVersionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async restore(
    input: RestoreSourceVersionInput,
  ): Promise<SourceVersionRestoreResult> {
    return this.withProjectLock(input.projectId, async () => {
      const existing = this.#events.find(
        (event) =>
          event.actorUserId === input.actorUserId &&
          event.requestId === input.requestId,
      );
      if (existing) {
        assertReplayMatches(existing, input);
        const project = await this.requireOwnedProject(input);
        return { project, event: existing, replayed: true };
      }

      const project = await this.requireOwnedProject(input);
      if (
        project.currentSourceVersionId !==
        input.expectedCurrentSourceVersionId
      ) {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_CONFLICT",
          "تغير إصدار المصدر الحالي. أعد تحميل سجل الإصدارات ثم حاول مجددًا.",
        );
      }
      if (project.currentSourceVersionId === input.targetSourceVersionId) {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_ALREADY_CURRENT",
          "إصدار المصدر المحدد هو الإصدار الحالي بالفعل.",
        );
      }
      const target = await this.sourceVersions.findById(
        input.targetSourceVersionId,
      );
      if (!target || target.projectId !== input.projectId) {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_NOT_FOUND",
          "إصدار المصدر المطلوب غير موجود.",
        );
      }
      if (target.status !== "ready") {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_NOT_READY",
          "لا يمكن استعادة إصدار مصدر غير مكتمل أو غير جاهز.",
        );
      }

      const updated = await this.projects.updateCurrentSourceVersion(
        project.id,
        target.id,
        target.versionNumber,
      );
      if (!updated) {
        throw new SourceVersionRestoreDomainError(
          "PROJECT_NOT_FOUND",
          "المشروع غير موجود أو لا تملك صلاحية الوصول إليه.",
        );
      }
      const reviewed =
        (await this.projects.updateStatus(project.id, "needs_review")) ??
        updated;
      const event: SourceVersionRestoreEvent = {
        id: crypto.randomUUID(),
        projectId: project.id,
        actorUserId: input.actorUserId,
        fromSourceVersionId: input.expectedCurrentSourceVersionId,
        toSourceVersionId: target.id,
        reason: input.reason,
        requestId: input.requestId,
        createdAt: this.now().toISOString(),
      };
      this.#events.push(event);
      return { project: reviewed, event, replayed: false };
    });
  }

  async list(
    projectId: string,
    actorUserId: string,
    limit = 100,
  ): Promise<SourceVersionRestoreEvent[]> {
    await this.requireOwnedProject({ projectId, actorUserId });
    return this.#events
      .filter((event) => event.projectId === projectId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 200)));
  }

  private async requireOwnedProject(input: {
    projectId: string;
    actorUserId: string;
  }): Promise<ProjectSummary> {
    const project = await this.projects.findOwnedById(
      input.actorUserId,
      input.projectId,
    );
    if (!project || !project.currentSourceVersionId) {
      throw new SourceVersionRestoreDomainError(
        "PROJECT_NOT_FOUND",
        "المشروع غير موجود أو لا يملك إصدار مصدر حاليًا.",
      );
    }
    return project;
  }

  private async withProjectLock<T>(
    projectId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#locks.get(projectId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.#locks.set(projectId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(projectId) === queued) {
        this.#locks.delete(projectId);
      }
    }
  }
}

export function assertReplayMatches(
  event: SourceVersionRestoreEvent,
  input: RestoreSourceVersionInput,
): void {
  if (
    event.projectId !== input.projectId ||
    event.toSourceVersionId !== input.targetSourceVersionId ||
    event.fromSourceVersionId !== input.expectedCurrentSourceVersionId ||
    event.reason !== input.reason
  ) {
    throw new SourceVersionRestoreDomainError(
      "IDEMPOTENCY_CONFLICT",
      "استُخدم مفتاح الطلب نفسه لعملية استعادة مختلفة.",
    );
  }
}
