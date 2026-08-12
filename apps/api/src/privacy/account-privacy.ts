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
  objectKeys: string[];
  attempt: number;
  requestedAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type PrepareAccountDeletionResult =
  | { kind: "ready"; request: AccountDeletionRequest }
  | { kind: "active_subscription" };

export interface AccountPrivacyRepository {
  exportAccount(userId: string, generatedAt: string): Promise<AccountDataExport>;
  prepareDeletion(
    userId: string,
    requestedAt: string,
  ): Promise<PrepareAccountDeletionResult>;
  listPendingDeletions(limit: number): Promise<AccountDeletionRequest[]>;
  markDeletionFailed(
    requestId: string,
    attemptedAt: string,
    message: string,
  ): Promise<void>;
  completeDeletion(
    requestId: string,
    userId: string,
    completedAt: string,
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
    private readonly concurrency = 4,
  ) {}

  async process(request: AccountDeletionRequest): Promise<AccountDeletionRequest["status"]> {
    const failures: string[] = [];
    for (let offset = 0; offset < request.objectKeys.length; offset += this.concurrency) {
      const keys = request.objectKeys.slice(offset, offset + this.concurrency);
      const results = await Promise.allSettled(
        keys.map((key) => this.storage.delete(key)),
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          failures.push(`${keys[index]}: ${errorMessage(result.reason)}`);
        }
      });
    }
    const attemptedAt = this.now().toISOString();
    if (failures.length > 0) {
      await this.repository.markDeletionFailed(
        request.id,
        attemptedAt,
        failures.join("; ").slice(0, 1_000),
      );
      return "failed";
    }
    await this.repository.completeDeletion(request.id, request.userId, attemptedAt);
    return "completed";
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
          objectKeys: [],
          attempt: 1,
          requestedAt,
          updatedAt: requestedAt,
          completedAt: null,
        };
    this.#requests.set(request.id, request);
    return { kind: "ready", request };
  }

  async listPendingDeletions(limit: number): Promise<AccountDeletionRequest[]> {
    return [...this.#requests.values()]
      .filter((request) => request.status !== "completed")
      .slice(0, limit);
  }

  async markDeletionFailed(
    requestId: string,
    attemptedAt: string,
    _message: string,
  ): Promise<void> {
    const request = this.#requests.get(requestId);
    if (request) this.#requests.set(requestId, { ...request, status: "failed", updatedAt: attemptedAt });
  }

  async completeDeletion(
    requestId: string,
    _userId: string,
    completedAt: string,
  ): Promise<void> {
    const request = this.#requests.get(requestId);
    if (request) {
      this.#requests.set(requestId, {
        ...request,
        status: "completed",
        objectKeys: [],
        updatedAt: completedAt,
        completedAt,
      });
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
