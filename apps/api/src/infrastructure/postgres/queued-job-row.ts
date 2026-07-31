import { toIso } from "./database.js";

export interface QueuedJobRow<Status extends string> {
  status: Status;
  progress: number;
  attempt: number;
  max_attempts: number;
  next_attempt_at: Date | string;
  lease_owner: string | null;
  lease_expires_at: Date | string | null;
  error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export function mapQueuedJobRow<Status extends string>(
  row: QueuedJobRow<Status>,
) {
  return {
    status: row.status,
    progress: row.progress,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    nextAttemptAt: toIso(row.next_attempt_at),
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at
      ? toIso(row.lease_expires_at)
      : null,
    errorCode: row.error_code,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}
