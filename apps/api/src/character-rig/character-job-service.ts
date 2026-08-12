import type { CharacterJob, CharacterJobType } from "@motionprep/contracts";
import type { CharacterJobRepository } from "./character-job-repository.js";

export interface EnqueueCharacterJobInput {
  projectId: string;
  type: CharacterJobType;
  operationKey: string;
  requestHash: string;
  payload: CharacterJob["payload"];
  now: string;
  maxAttempts?: number;
}

export class CharacterJobService {
  constructor(private readonly jobs: CharacterJobRepository) {}

  async enqueue(input: EnqueueCharacterJobInput): Promise<CharacterJob> {
    const existing = await this.jobs.findByOperationKey(
      input.projectId,
      input.operationKey,
    );
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        throw new CharacterJobIdempotencyConflictError();
      }
      return existing;
    }
    const job: CharacterJob = {
      id: crypto.randomUUID(),
      projectId: input.projectId,
      type: input.type,
      status: "queued",
      operationKey: input.operationKey,
      requestHash: input.requestHash,
      payload: structuredClone(input.payload),
      attempt: 0,
      maxAttempts: input.maxAttempts ?? 3,
      nextAttemptAt: input.now,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    await this.jobs.save(job);
    return job;
  }
}

export class CharacterJobIdempotencyConflictError extends Error {
  readonly code = "CHARACTER_JOB_IDEMPOTENCY_CONFLICT";

  constructor() {
    super("The character job operation key was reused with a different request.");
  }
}
