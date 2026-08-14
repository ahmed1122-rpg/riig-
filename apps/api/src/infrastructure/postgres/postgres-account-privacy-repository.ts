import type { Pool, PoolClient } from "pg";
import type {
  AccountDataExport,
  AccountDeletionRequest,
  AccountPrivacyRepository,
  PrepareAccountDeletionResult,
  ReconcileAccountDeletionResult,
} from "../../privacy/account-privacy.js";
import { rollbackTransaction, toIso } from "./database.js";
import { PostgresAccountDeletionState } from "./postgres-account-deletion-state.js";

export class PostgresAccountPrivacyRepository
  implements AccountPrivacyRepository
{
  private readonly deletion: PostgresAccountDeletionState;

  constructor(private readonly pool: Pool) {
    this.deletion = new PostgresAccountDeletionState(pool);
  }

  async exportAccount(userId: string, generatedAt: string): Promise<AccountDataExport> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const account = await client.query(
        `SELECT id, name, email, role, status, mfa_enabled AS "mfaEnabled",
                created_at AS "createdAt", last_login_at AS "lastLoginAt",
                terms_version, privacy_version, legal_accepted_at
         FROM users
         WHERE id = $1 AND deleted_at IS NULL`,
        [userId],
      );
      if (!account.rows[0]) throw new Error("Account not found.");
      const projects = await client.query(
            `SELECT id, name, kind, status, created_at AS "createdAt",
                    updated_at AS "updatedAt"
             FROM projects WHERE owner_user_id = $1 ORDER BY created_at`,
            [userId],
          );
      const sources = await client.query(
            `SELECT source.id, source.project_id AS "projectId",
                    source.version_number AS "versionNumber", source.filename,
                    source.content_type AS "contentType", source.size_bytes AS "sizeBytes",
                    source.status, source.sha256, source.created_at AS "createdAt"
             FROM source_versions source
             JOIN projects project ON project.id = source.project_id
             WHERE project.owner_user_id = $1
             ORDER BY source.created_at`,
            [userId],
          );
      const exports = await client.query(
            `SELECT job.id, job.project_id AS "projectId", job.format, job.scope,
                    job.status, job.progress, job.created_at AS "createdAt",
                    job.updated_at AS "updatedAt",
                    CASE WHEN job.artifact IS NULL THEN NULL ELSE
                      jsonb_build_object(
                        'filename', job.artifact->>'filename',
                        'sizeBytes', job.artifact->'sizeBytes',
                        'expiresAt', job.artifact->>'expiresAt'
                      ) END AS artifact
             FROM export_jobs job
             JOIN projects project ON project.id = job.project_id
             WHERE project.owner_user_id = $1
             ORDER BY job.created_at`,
            [userId],
          );
      const subscriptions = await client.query(
            `SELECT id, plan_id AS "planId", status, renewal_at AS "renewalAt",
                    provider, cancel_at_period_end AS "cancelAtPeriodEnd"
             FROM subscriptions WHERE user_id = $1`,
            [userId],
          );
      const checkouts = await client.query(
            `SELECT id, provider, plan_id AS "planId", status, currency,
                    amount_minor AS "amountMinor", created_at AS "createdAt",
                    expires_at AS "expiresAt"
             FROM checkout_sessions WHERE user_id = $1 ORDER BY created_at`,
            [userId],
          );
      const audits = await client.query(
            `SELECT id, action, target_type AS "targetType", target_id AS "targetId",
                    outcome, reason, request_id AS "requestId", created_at AS "createdAt"
             FROM audit_events WHERE actor_user_id = $1 ORDER BY created_at`,
            [userId],
          );
      const layerDocuments = await client.query(
        `SELECT document.document
         FROM layer_documents document
         JOIN projects project ON project.id = document.project_id
         WHERE project.owner_user_id = $1
         ORDER BY document.project_id, document.source_version_id`,
        [userId],
      );
      const layerDocumentRevisions = await client.query(
        `SELECT revision.document
         FROM layer_document_revisions revision
         JOIN projects project ON project.id = revision.project_id
         WHERE project.owner_user_id = $1
         ORDER BY revision.project_id, revision.source_version_id, revision.revision`,
        [userId],
      );
      const sourceVersionRestores = await client.query(
        `SELECT event.id, event.operation_id AS "operationId",
                event.project_id AS "projectId",
                event.actor_user_id AS "actorUserId",
                event.from_source_version_id AS "fromSourceVersionId",
                event.to_source_version_id AS "toSourceVersionId",
                event.reason, event.idempotency_key AS "idempotencyKey",
                event.originating_request_id AS "originatingRequestId",
                event.request_id AS "requestId", event.created_at AS "createdAt"
         FROM source_version_restore_events event
         JOIN projects project ON project.id = event.project_id
         WHERE project.owner_user_id = $1
         ORDER BY event.created_at, event.id`,
        [userId],
      );
      const processingJobs = await client.query(
        `SELECT job.id, job.project_id AS "projectId",
                job.source_version_id AS "sourceVersionId",
                job.project_kind AS "projectKind", job.status, job.progress,
                job.options, job.attempt, job.max_attempts AS "maxAttempts",
                job.error_code AS "errorCode",
                job.created_at AS "createdAt", job.updated_at AS "updatedAt"
         FROM processing_jobs job
         JOIN projects project ON project.id = job.project_id
         WHERE project.owner_user_id = $1
         ORDER BY job.created_at, job.id`,
        [userId],
      );
      const projectReviewApprovals = await client.query(
        `SELECT approval.id, approval.project_id AS "projectId",
                approval.source_version_id AS "sourceVersionId",
                approval.document_revision AS "documentRevision",
                approval.actor_user_id AS "actorUserId",
                approval.operation_id AS "operationId",
                approval.approved_at AS "approvedAt"
         FROM project_review_approvals approval
         JOIN projects project ON project.id = approval.project_id
         WHERE project.owner_user_id = $1
         ORDER BY approval.approved_at, approval.id`,
        [userId],
      );
      const characterBibles = await selectOwnedCharacterDocuments(
        client,
        "character_bibles",
        userId,
      );
      const characterReferences = await selectOwnedCharacterDocuments(
        client,
        "character_reference_assets",
        userId,
      );
      const characterIdentityModels = await client.query(
        `SELECT model.document - 'providerKey' - 'providerModelReference' AS document
         FROM character_identity_model_versions model
         JOIN projects project ON project.id = model.project_id
         WHERE project.owner_user_id = $1
         ORDER BY model.created_at, model.id`,
        [userId],
      );
      const characterGenerations = await selectOwnedCharacterDocuments(
        client,
        "character_generation_attempts",
        userId,
      );
      const characterGenerationReviews = await selectOwnedCharacterDocuments(
        client,
        "character_generation_reviews",
        userId,
      );
      const characterRigs = await selectOwnedCharacterDocuments(
        client,
        "character_rig_versions",
        userId,
      );
      const characterRigReviews = await selectOwnedCharacterDocuments(
        client,
        "character_rig_reviews",
        userId,
      );
      const characterJobs = await client.query(
        `SELECT job.document - 'leaseOwner' - 'leaseExpiresAt' AS document
         FROM character_jobs job
         JOIN projects project ON project.id = job.project_id
         WHERE project.owner_user_id = $1
         ORDER BY job.created_at, job.id`,
        [userId],
      );
      await client.query("COMMIT");
      const row = account.rows[0] as Record<string, unknown>;
      return {
        schemaVersion: "2",
        generatedAt,
        account: {
          id: String(row.id),
          name: String(row.name),
          email: String(row.email),
          role: row.role as AccountDataExport["account"]["role"],
          status: row.status as AccountDataExport["account"]["status"],
          mfaEnabled: Boolean(row.mfaEnabled),
          createdAt: toIso(row.createdAt as Date | string),
          lastLoginAt: row.lastLoginAt
            ? toIso(row.lastLoginAt as Date | string)
            : null,
        },
        legal: {
          termsVersion: typeof row.terms_version === "string" ? row.terms_version : null,
          privacyVersion: typeof row.privacy_version === "string" ? row.privacy_version : null,
          acceptedAt: row.legal_accepted_at
            ? toIso(row.legal_accepted_at as Date | string)
            : null,
        },
        projects: projects.rows,
        sourceVersions: sources.rows,
        exports: exports.rows,
        subscriptions: subscriptions.rows,
        checkoutSessions: checkouts.rows,
        auditEvents: audits.rows,
        content: {
          layerDocuments: documentsFrom(layerDocuments.rows),
          layerDocumentRevisions: documentsFrom(layerDocumentRevisions.rows),
          sourceVersionRestores: sourceVersionRestores.rows,
          processingJobs: processingJobs.rows,
          projectReviewApprovals: projectReviewApprovals.rows,
        },
        character: {
          bibles: documentsFrom(characterBibles.rows),
          references: documentsFrom(characterReferences.rows),
          identityModels: documentsFrom(characterIdentityModels.rows),
          generations: documentsFrom(characterGenerations.rows),
          generationReviews: documentsFrom(characterGenerationReviews.rows),
          rigs: documentsFrom(characterRigs.rows),
          rigReviews: documentsFrom(characterRigReviews.rows),
          jobs: documentsFrom(characterJobs.rows),
        },
      };
    } catch (error) {
      await rollbackTransaction(client, error);
      throw error;
    } finally {
      client.release();
    }
  }

  async prepareDeletion(
    userId: string,
    requestedAt: string,
  ): Promise<PrepareAccountDeletionResult> {
    return this.deletion.prepare(userId, requestedAt);
  }

  async listPendingDeletions(limit: number): Promise<AccountDeletionRequest[]> {
    return this.deletion.listPending(limit);
  }

  async claimDeletion(
    requestId: string,
    processorLeaseId: string,
    claimedAt: string,
    expiresAt: string,
  ): Promise<boolean> {
    return this.deletion.claim(
      requestId,
      processorLeaseId,
      claimedAt,
      expiresAt,
    );
  }

  async reconcileDeletion(
    requestId: string,
    userId: string,
    reconciledAt: string,
    processorLeaseId: string,
  ): Promise<ReconcileAccountDeletionResult> {
    return this.deletion.reconcile(
      requestId,
      userId,
      reconciledAt,
      processorLeaseId,
    );
  }

  async recordDeletionInventory(
    requestId: string,
    objectKeys: string[],
    recordedAt: string,
    processorLeaseId: string,
  ): Promise<AccountDeletionRequest> {
    return this.deletion.recordInventory(
      requestId,
      objectKeys,
      recordedAt,
      processorLeaseId,
    );
  }

  async markDeletionFailed(
    requestId: string,
    attemptedAt: string,
    message: string,
    processorLeaseId: string,
  ): Promise<void> {
    return this.deletion.markFailed(
      requestId,
      attemptedAt,
      message,
      processorLeaseId,
    );
  }

  async completeDeletion(
    requestId: string,
    userId: string,
    completedAt: string,
    processorLeaseId: string,
  ): Promise<void> {
    return this.deletion.complete(
      requestId,
      userId,
      completedAt,
      processorLeaseId,
    );
  }
}

interface DocumentExportRow {
  document: unknown;
}

function selectOwnedCharacterDocuments(
  client: PoolClient,
  table: string,
  userId: string,
): Promise<{ rows: DocumentExportRow[] }> {
  const allowedTables = new Set([
    "character_bibles",
    "character_reference_assets",
    "character_generation_attempts",
    "character_generation_reviews",
    "character_rig_versions",
    "character_rig_reviews",
  ]);
  if (!allowedTables.has(table)) {
    throw new Error("Unsupported character export table.");
  }
  return client.query<DocumentExportRow>(
    `SELECT record.document
     FROM ${table} record
     JOIN projects project ON project.id = record.project_id
     WHERE project.owner_user_id = $1
     ORDER BY record.created_at, record.id`,
    [userId],
  );
}

function documentsFrom(rows: unknown[]): unknown[] {
  return rows.map((row) =>
    redactPrivateMetadata((row as DocumentExportRow).document),
  );
}

const PRIVATE_EXPORT_FIELDS = new Set([
  "objectKey",
  "providerKey",
  "providerModelReference",
  "leaseOwner",
  "leaseExpiresAt",
]);

function redactPrivateMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPrivateMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !PRIVATE_EXPORT_FIELDS.has(key))
      .map(([key, nested]) => [key, redactPrivateMetadata(nested)]),
  );
}
