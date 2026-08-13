import type { UserSummary } from "@motionprep/contracts";
import type { AuthRepository } from "../auth/auth-repository.js";
import type { AuthService } from "../auth/auth-service.js";
import type { ObjectStorage } from "../storage/object-storage.js";

export interface AccountDataExport {
  schemaVersion: "2";
  generatedAt: string;
  account: UserSummary;
  legal: {
    termsVersion: string | null;
    privacyVersion: string | null;
    acceptedAt: string | null;
  };
  projects: unknown[];
  sourceVersions: unknown[];
  exports: unknown[];
  subscriptions: unknown[];
  checkoutSessions: unknown[];
  auditEvents: unknown[];
  content: {
    layerDocuments: unknown[];
    layerDocumentRevisions: unknown[];
    sourceVersionRestores: unknown[];
    processingJobs: unknown[];
    projectReviewApprovals: unknown[];
  };
  character: {
    bibles: unknown[];
    references: unknown[];
    identityModels: unknown[];
    generations: unknown[];
    generationReviews: unknown[];
    rigs: unknown[];
    rigReviews: unknown[];
    jobs: unknown[];
  };
}

export interface AccountDeletionRequest {
  id: string;
  userId: string;
  status: "processing" | "failed" | "completed";
  phase: "draining" | "purging" | "completed";
  objectKeys: string[];
  objectPrefixes: string[];
  attempt: number;
  requestedAt: string;
  updatedAt: string;
  completedAt: string | null;
  drainedAt: string | null;
}

export type PrepareAccountDeletionResult =
  | { kind: "ready"; request: AccountDeletionRequest }
  | { kind: "active_subscription" };

export type ReconcileAccountDeletionResult =
  | { kind: "draining"; request: AccountDeletionRequest }
  | { kind: "ready"; request: AccountDeletionRequest };

export interface AccountPrivacyRepository {
  exportAccount(userId: string, generatedAt: string): Promise<AccountDataExport>;
  prepareDeletion(
    userId: string,
    requestedAt: string,
  ): Promise<PrepareAccountDeletionResult>;
  listPendingDeletions(limit: number): Promise<AccountDeletionRequest[]>;
  claimDeletion(
    requestId: string,
    processorLeaseId: string,
    claimedAt: string,
    expiresAt: string,
  ): Promise<boolean>;
  reconcileDeletion(
    requestId: string,
    userId: string,
    reconciledAt: string,
    processorLeaseId: string,
  ): Promise<ReconcileAccountDeletionResult>;
  recordDeletionInventory(
    requestId: string,
    objectKeys: string[],
    recordedAt: string,
    processorLeaseId: string,
  ): Promise<AccountDeletionRequest>;
  markDeletionFailed(
    requestId: string,
    attemptedAt: string,
    message: string,
    processorLeaseId: string,
  ): Promise<void>;
  completeDeletion(
    requestId: string,
    userId: string,
    completedAt: string,
    processorLeaseId: string,
  ): Promise<void>;
}

export class AccountPrivacyError extends Error {
  constructor(
    readonly code: "ACTIVE_SUBSCRIPTION" | "ACCOUNT_DELETION_FAILED",
    message: string,
  ) {
    super(message);
  }
}

export class AccountDeletionProcessor {
  constructor(
    private readonly repository: AccountPrivacyRepository,
    private readonly storage: ObjectStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async process(request: AccountDeletionRequest): Promise<AccountDeletionRequest["status"]> {
    const attemptedAt = this.now().toISOString();
    if (request.status === "completed") return "completed";
    const processorLeaseId = crypto.randomUUID();
    const claimed = await this.repository.claimDeletion(
      request.id,
      processorLeaseId,
      attemptedAt,
      new Date(new Date(attemptedAt).getTime() + 60 * 60_000).toISOString(),
    );
    if (!claimed) return "processing";
    try {
      const reconciled = await this.repository.reconcileDeletion(
        request.id,
        request.userId,
        attemptedAt,
        processorLeaseId,
      );
      if (reconciled.kind === "draining") return "processing";

      const inventory = new Set(reconciled.request.objectKeys);
      for (const prefix of reconciled.request.objectPrefixes) {
        for (const key of await this.storage.list(prefix)) inventory.add(key);
      }
      const recorded = await this.repository.recordDeletionInventory(
        request.id,
        [...inventory].sort((left, right) => left.localeCompare(right)),
        attemptedAt,
        processorLeaseId,
      );
      await this.storage.purge(recorded.objectKeys, recorded.objectPrefixes);
      await this.repository.completeDeletion(
        request.id,
        request.userId,
        attemptedAt,
        processorLeaseId,
      );
      return "completed";
    } catch (error) {
      try {
        await this.repository.markDeletionFailed(
          request.id,
          attemptedAt,
          errorMessage(error).slice(0, 1_000),
          processorLeaseId,
        );
      } catch (markError) {
        throw new AggregateError(
          [error, markError],
          "Account deletion failed and its processor lease could not be released.",
          { cause: markError },
        );
      }
      return "failed";
    }
  }
}

export class AccountPrivacyService {
  constructor(
    private readonly repository: AccountPrivacyRepository,
    private readonly auth: AuthService,
    private readonly processor: AccountDeletionProcessor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  exportAccount(userId: string): Promise<AccountDataExport> {
    return this.repository.exportAccount(userId, this.now().toISOString());
  }

  async requestDeletion(input: {
    userId: string;
    password: string;
  }): Promise<{ requestId: string; status: "processing" | "failed" | "completed" }> {
    await this.auth.verifyCurrentPassword(input.userId, input.password);
    const prepared = await this.repository.prepareDeletion(
      input.userId,
      this.now().toISOString(),
    );
    if (prepared.kind === "active_subscription") {
      throw new AccountPrivacyError(
        "ACTIVE_SUBSCRIPTION",
        "ألغِ الاشتراك المدفوع أولًا قبل حذف الحساب.",
      );
    }
    const status = await this.processor.process(prepared.request);
    return { requestId: prepared.request.id, status };
  }
}

export class InMemoryAccountPrivacyRepository
  implements AccountPrivacyRepository
{
  readonly #requests = new Map<string, AccountDeletionRequest>();
  readonly #processorLeases = new Map<string, { id: string; expiresAt: string }>();

  constructor(private readonly auth: AuthRepository) {}

  async exportAccount(userId: string, generatedAt: string): Promise<AccountDataExport> {
    const user = await this.auth.findUserById(userId);
    if (!user) throw new Error("Account not found.");
    const {
      passwordHash: _passwordHash,
      mfaSecretCiphertext: _mfaSecretCiphertext,
      recoveryCodeHashes: _recoveryCodeHashes,
      termsVersion,
      privacyVersion,
      legalAcceptedAt,
      deletionRequestedAt: _deletionRequestedAt,
      deletedAt: _deletedAt,
      ...account
    } = user;
    return {
      schemaVersion: "2",
      generatedAt,
      account,
      legal: {
        termsVersion: termsVersion ?? null,
        privacyVersion: privacyVersion ?? null,
        acceptedAt: legalAcceptedAt ?? null,
      },
      projects: [],
      sourceVersions: [],
      exports: [],
      subscriptions: [],
      checkoutSessions: [],
      auditEvents: [],
      content: {
        layerDocuments: [],
        layerDocumentRevisions: [],
        sourceVersionRestores: [],
        processingJobs: [],
        projectReviewApprovals: [],
      },
      character: {
        bibles: [],
        references: [],
        identityModels: [],
        generations: [],
        generationReviews: [],
        rigs: [],
        rigReviews: [],
        jobs: [],
      },
    };
  }

  async prepareDeletion(
    userId: string,
    requestedAt: string,
  ): Promise<PrepareAccountDeletionResult> {
    const existing = [...this.#requests.values()].find(
      (request) => request.userId === userId,
    );
    if (existing?.status === "completed") return { kind: "ready", request: existing };
    await this.auth.updateUser(userId, { status: "suspended" });
    await this.auth.deleteSessionsByUser(userId);
    const request: AccountDeletionRequest = existing
      ? {
          ...existing,
          status: "processing",
          attempt: existing.attempt + 1,
          updatedAt: requestedAt,
        }
      : {
          id: crypto.randomUUID(),
          userId,
          status: "processing",
          phase: "draining",
          objectKeys: [],
          objectPrefixes: [],
          attempt: 1,
          requestedAt,
          updatedAt: requestedAt,
          completedAt: null,
          drainedAt: requestedAt,
        };
    this.#requests.set(request.id, request);
    return { kind: "ready", request };
  }

  async listPendingDeletions(limit: number): Promise<AccountDeletionRequest[]> {
    return [...this.#requests.values()]
      .filter((request) => request.status !== "completed")
      .slice(0, limit);
  }

  async claimDeletion(
    requestId: string,
    processorLeaseId: string,
    claimedAt: string,
    expiresAt: string,
  ): Promise<boolean> {
    const request = this.#requests.get(requestId);
    if (!request || request.status === "completed") return false;
    const current = this.#processorLeases.get(requestId);
    if (current && current.expiresAt > claimedAt) return false;
    this.#processorLeases.set(requestId, { id: processorLeaseId, expiresAt });
    return true;
  }

  async reconcileDeletion(
    requestId: string,
    _userId: string,
    reconciledAt: string,
    processorLeaseId: string,
  ): Promise<ReconcileAccountDeletionResult> {
    const request = this.#requests.get(requestId);
    if (!request) throw new Error("Account deletion request not found.");
    this.requireProcessorLease(requestId, processorLeaseId, reconciledAt);
    if (request.status === "completed") return { kind: "ready", request };
    const reconciled: AccountDeletionRequest = {
      ...request,
      status: "processing",
      phase: "purging",
      drainedAt: request.drainedAt ?? reconciledAt,
      updatedAt: reconciledAt,
    };
    this.#requests.set(requestId, reconciled);
    return { kind: "ready", request: reconciled };
  }

  async recordDeletionInventory(
    requestId: string,
    objectKeys: string[],
    recordedAt: string,
    processorLeaseId: string,
  ): Promise<AccountDeletionRequest> {
    const request = this.#requests.get(requestId);
    if (!request) throw new Error("Account deletion request not found.");
    this.requireProcessorLease(requestId, processorLeaseId, recordedAt);
    const recorded = {
      ...request,
      objectKeys: [...new Set(objectKeys)],
      updatedAt: recordedAt,
    };
    this.#requests.set(requestId, recorded);
    return recorded;
  }

  async markDeletionFailed(
    requestId: string,
    attemptedAt: string,
    _message: string,
    processorLeaseId: string,
  ): Promise<void> {
    const request = this.#requests.get(requestId);
    if (!request) return;
    this.requireProcessorLease(requestId, processorLeaseId, attemptedAt);
    this.#requests.set(requestId, { ...request, status: "failed", updatedAt: attemptedAt });
    this.#processorLeases.delete(requestId);
  }

  async completeDeletion(
    requestId: string,
    _userId: string,
    completedAt: string,
    processorLeaseId: string,
  ): Promise<void> {
    const request = this.#requests.get(requestId);
    if (request) {
      this.requireProcessorLease(requestId, processorLeaseId, completedAt);
      this.#requests.set(requestId, {
        ...request,
        status: "completed",
        phase: "completed",
        objectKeys: [],
        objectPrefixes: [],
        updatedAt: completedAt,
        completedAt,
      });
      this.#processorLeases.delete(requestId);
    }
  }

  private requireProcessorLease(
    requestId: string,
    processorLeaseId: string,
    now: string,
  ): void {
    const lease = this.#processorLeases.get(requestId);
    if (!lease || lease.id !== processorLeaseId || lease.expiresAt <= now) {
      throw new Error("Account deletion processor lease was lost.");
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
