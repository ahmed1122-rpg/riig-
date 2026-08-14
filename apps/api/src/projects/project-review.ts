import type {
  ProductionIssue,
  ProjectReviewApproval,
  ProjectReviewApprovalResult,
} from "@motionprep/contracts";
import { validateProductionDocument } from "@motionprep/layer-domain";
import type { LayerDocumentRepository } from "../processing/processing-repository.js";
import { InMemoryProjectOperationLock } from "./in-memory-project-operation-lock.js";
import type { ProjectRepository } from "./project-repository.js";

export type ProjectReviewErrorCode =
  | "PROJECT_NOT_FOUND"
  | "REVIEW_SOURCE_CONFLICT"
  | "REVIEW_DOCUMENT_NOT_READY"
  | "REVIEW_REVISION_CONFLICT"
  | "REVIEW_PREFLIGHT_FAILED"
  | "REVIEW_STATE_CONFLICT"
  | "IDEMPOTENCY_CONFLICT";

export class ProjectReviewDomainError extends Error {
  constructor(
    readonly code: ProjectReviewErrorCode,
    message: string,
    readonly issues: readonly ProductionIssue[] = [],
  ) {
    super(message);
  }
}

export interface ApproveProjectReviewInput {
  projectId: string;
  sourceVersionId: string;
  documentRevision: number;
  actorUserId: string;
  operationId: string;
}

export interface ProjectReviewCommand {
  approve(
    input: ApproveProjectReviewInput,
  ): Promise<ProjectReviewApprovalResult>;
  findCurrent(projectId: string): Promise<ProjectReviewApproval | null>;
}

export class InMemoryProjectReviewCommand implements ProjectReviewCommand {
  readonly #approvalsByOperation = new Map<string, ProjectReviewApproval>();
  readonly #projectOperations = new InMemoryProjectOperationLock();

  constructor(
    private readonly projects: ProjectRepository,
    private readonly documents: LayerDocumentRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async approve(
    input: ApproveProjectReviewInput,
  ): Promise<ProjectReviewApprovalResult> {
    return this.#projectOperations.run(input.projectId, async () => {
      const operationKey = `${input.actorUserId}:${input.operationId}`;
      const replay = this.#approvalsByOperation.get(operationKey);
      if (replay) {
        assertReviewReplayMatches(replay, input);
        const project = await this.requireOwnedProject(input);
        return { project, approval: structuredClone(replay), replayed: true };
      }

      const project = await this.requireOwnedProject(input);
      if (project.currentSourceVersionId !== input.sourceVersionId) {
        throw reviewError(
          "REVIEW_SOURCE_CONFLICT",
          "تغير إصدار المصدر الحالي قبل اعتماد المراجعة.",
        );
      }
      const document = await this.documents.findBySource(
        input.projectId,
        input.sourceVersionId,
      );
      if (!document) {
        throw reviewError(
          "REVIEW_DOCUMENT_NOT_READY",
          "وثيقة الطبقات غير جاهزة للاعتماد.",
        );
      }
      if ((document.revision ?? 1) !== input.documentRevision) {
        throw reviewError(
          "REVIEW_REVISION_CONFLICT",
          "تغيرت وثيقة الطبقات قبل اعتماد المراجعة.",
        );
      }
      const issues = validateProductionDocument(document, project.kind);
      if (issues.length > 0) {
        throw new ProjectReviewDomainError(
          "REVIEW_PREFLIGHT_FAILED",
          issues[0]?.message ?? "فشل فحص وثيقة الطبقات.",
          issues,
        );
      }

      const approval: ProjectReviewApproval = {
        id: crypto.randomUUID(),
        projectId: input.projectId,
        sourceVersionId: input.sourceVersionId,
        documentRevision: input.documentRevision,
        actorUserId: input.actorUserId,
        operationId: input.operationId,
        approvedAt: this.now().toISOString(),
      };
      const approved = await this.projects.applyReviewApproval(approval);
      if (!approved) {
        throw reviewError(
          "REVIEW_STATE_CONFLICT",
          "تغيرت حالة المشروع قبل اعتماد المراجعة.",
        );
      }
      this.#approvalsByOperation.set(operationKey, approval);
      return { project: approved, approval, replayed: false };
    });
  }

  findCurrent(projectId: string): Promise<ProjectReviewApproval | null> {
    return this.projects.findCurrentReviewApproval(projectId);
  }

  private async requireOwnedProject(input: {
    projectId: string;
    actorUserId: string;
  }) {
    const project = await this.projects.findOwnedById(
      input.actorUserId,
      input.projectId,
    );
    if (!project) {
      throw reviewError(
        "PROJECT_NOT_FOUND",
        "المشروع غير موجود أو لا تملك صلاحية الوصول إليه.",
      );
    }
    return project;
  }
}

export function assertReviewReplayMatches(
  approval: ProjectReviewApproval,
  input: ApproveProjectReviewInput,
): void {
  if (
    approval.projectId !== input.projectId ||
    approval.sourceVersionId !== input.sourceVersionId ||
    approval.documentRevision !== input.documentRevision ||
    approval.actorUserId !== input.actorUserId
  ) {
    throw reviewError(
      "IDEMPOTENCY_CONFLICT",
      "استُخدم مفتاح العملية نفسه لاعتماد مراجعة مختلفة.",
    );
  }
}

function reviewError(
  code: ProjectReviewErrorCode,
  message: string,
): ProjectReviewDomainError {
  return new ProjectReviewDomainError(code, message);
}
