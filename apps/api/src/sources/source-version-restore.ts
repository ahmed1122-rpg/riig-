import type {
  ProjectSummary,
  SourceVersionRestoreEvent,
  SourceVersionRestoreResult,
} from "@motionprep/contracts";
import { InMemoryProjectOperationLock } from "../projects/in-memory-project-operation-lock.js";
import type { ProjectRepository } from "../projects/project-repository.js";
import type { SourceVersionRepository } from "./source-version-repository.js";

export type SourceVersionRestoreErrorCode =
  | "PROJECT_NOT_FOUND"
  | "SOURCE_VERSION_NOT_FOUND"
  | "SOURCE_VERSION_NOT_READY"
  | "SOURCE_VERSION_CONFLICT"
  | "SOURCE_VERSION_ALREADY_CURRENT"
  | "SOURCE_VERSION_BUSY"
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
  idempotencyKey: string;
  originatingRequestId: string;
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
  readonly #projectOperations = new InMemoryProjectOperationLock();

  constructor(
    private readonly projects: ProjectRepository,
    private readonly sourceVersions: SourceVersionRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async restore(
    input: RestoreSourceVersionInput,
  ): Promise<SourceVersionRestoreResult> {
    return this.#projectOperations.run(input.projectId, async () => {
      const existing = this.#events.find(
        (event) =>
          event.actorUserId === input.actorUserId &&
          event.idempotencyKey === input.idempotencyKey,
      );
      if (existing) {
        assertReplayMatches(existing, input);
        const project = await this.requireOwnedProject(input);
        return { project, event: existing, replayed: true };
      }

      const project = await this.requireOwnedProject(input);
      if (await this.projects.hasActiveJob(project.id)) {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_BUSY",
          "لا يمكن استعادة إصدار مصدر بينما توجد مهمة معالجة أو تصدير نشطة. انتظر اكتمالها أو ألغها ثم أعد المحاولة.",
        );
      }
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
        true,
      );
      if (!updated) {
        throw new SourceVersionRestoreDomainError(
          "SOURCE_VERSION_BUSY",
          "لا يمكن استعادة إصدار مصدر بينما توجد مهمة معالجة أو تصدير نشطة. انتظر اكتمالها أو ألغها ثم أعد المحاولة.",
        );
      }
      const reviewed =
        (await this.projects.updateStatus(project.id, "needs_review")) ??
        updated;
      const event: SourceVersionRestoreEvent = {
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        projectId: project.id,
        actorUserId: input.actorUserId,
        fromSourceVersionId: input.expectedCurrentSourceVersionId,
        toSourceVersionId: target.id,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
        originatingRequestId: input.originatingRequestId,
        requestId: input.idempotencyKey,
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
}

export function assertReplayMatches(
  event: SourceVersionRestoreEvent,
  input: RestoreSourceVersionInput,
): void {
  if (
    event.actorUserId !== input.actorUserId ||
    event.idempotencyKey !== input.idempotencyKey ||
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
