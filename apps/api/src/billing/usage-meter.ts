import {
  BILLING_PLAN_CATALOG,
  type SubscriptionView,
} from "@motionprep/contracts";
import type { BillingRepository } from "./billing-repository.js";
import { roundUsage } from "./usage-rounding.js";

export type UsageMeterMode =
  | "off"
  | "shadow"
  | "soft"
  | "hard-jobs"
  | "hard";

export class UsageLimitError extends Error {
  constructor(
    readonly code:
      | "SUBSCRIPTION_INACTIVE"
      | "JOB_QUOTA_EXCEEDED"
      | "PROCESSING_MINUTES_QUOTA_EXCEEDED",
    message: string,
  ) {
    super(message);
  }
}

export interface UsageMeter {
  reserveJob(userId: string, jobId: string): Promise<void>;
  releaseJob(jobId: string): Promise<void>;
  recordProcessingSeconds(
    jobId: string,
    attempt: number,
    seconds: number,
  ): Promise<void>;
}

interface Reservation {
  userId: string;
  attempts: Set<number>;
  released: boolean;
}

export class RepositoryUsageMeter implements UsageMeter {
  readonly #reservations = new Map<string, Reservation>();
  readonly #locks = new Map<string, Promise<void>>();

  constructor(
    private readonly repository: BillingRepository,
    private readonly mode: UsageMeterMode,
    private readonly now: () => Date = () => new Date(),
  ) {}

  reserveJob(userId: string, jobId: string): Promise<void> {
    return this.withUserLock(userId, async () => {
      if (this.#reservations.has(jobId) || this.mode === "off") return;
      const subscription = await this.currentSubscription(userId);
      assertCanReserve(subscription, this.mode);
      await this.repository.saveSubscription({
        ...subscription,
        usage: {
          ...subscription.usage,
          jobs: subscription.usage.jobs + 1,
        },
      });
      this.#reservations.set(jobId, {
        userId,
        attempts: new Set(),
        released: false,
      });
    });
  }

  async releaseJob(jobId: string): Promise<void> {
    const reservation = this.#reservations.get(jobId);
    if (!reservation || reservation.released) return;
    await this.withUserLock(reservation.userId, async () => {
      if (reservation.released) return;
      const subscription = await this.currentSubscription(reservation.userId);
      await this.repository.saveSubscription({
        ...subscription,
        usage: {
          ...subscription.usage,
          jobs: Math.max(0, subscription.usage.jobs - 1),
        },
      });
      reservation.released = true;
    });
  }

  async recordProcessingSeconds(
    jobId: string,
    attempt: number,
    seconds: number,
  ): Promise<void> {
    const reservation = this.#reservations.get(jobId);
    if (
      !reservation ||
      reservation.released ||
      reservation.attempts.has(attempt)
    ) {
      return;
    }
    await this.withUserLock(reservation.userId, async () => {
      if (reservation.attempts.has(attempt)) return;
      const subscription = await this.currentSubscription(reservation.userId);
      const minutes = Math.max(0, seconds) / 60;
      await this.repository.saveSubscription({
        ...subscription,
        usage: {
          ...subscription.usage,
          processingMinutes: roundUsage(
            subscription.usage.processingMinutes + minutes,
          ),
        },
      });
      reservation.attempts.add(attempt);
    });
  }

  private async currentSubscription(
    userId: string,
  ): Promise<SubscriptionView> {
    const current =
      (await this.repository.findSubscription(userId)) ??
      starterSubscription(userId, this.now());
    if (Date.parse(current.renewalAt) > this.now().getTime()) return current;
    const renewed: SubscriptionView = {
      ...current,
      renewalAt: new Date(
        this.now().getTime() + 30 * 24 * 60 * 60_000,
      ).toISOString(),
      usage: {
        ...current.usage,
        jobs: 0,
        processingMinutes: 0,
      },
    };
    await this.repository.saveSubscription(renewed);
    return renewed;
  }

  private async withUserLock<T>(
    userId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#locks.get(userId) ?? Promise.resolve();
    const result = previous.then(operation, operation);
    const completed = result.then(
      () => undefined,
      () => undefined,
    );
    this.#locks.set(userId, completed);
    void completed.then(() => {
      if (this.#locks.get(userId) === completed) this.#locks.delete(userId);
    });
    return result;
  }
}

export function starterSubscription(
  userId: string,
  now: Date,
): SubscriptionView {
  const starter = BILLING_PLAN_CATALOG[0];
  return {
    id: crypto.randomUUID(),
    userId,
    planId: "starter",
    status: "active",
    renewalAt: new Date(
      now.getTime() + 30 * 24 * 60 * 60_000,
    ).toISOString(),
    usage: {
      jobs: 0,
      jobLimit: starter.jobLimit,
      processingMinutes: 0,
      processingMinuteLimit: starter.processingMinuteLimit,
    },
  };
}

export function assertCanReserve(
  subscription: SubscriptionView,
  mode: UsageMeterMode,
): void {
  if (!["active", "trialing"].includes(subscription.status)) {
    throw new UsageLimitError(
      "SUBSCRIPTION_INACTIVE",
      "الاشتراك غير نشط ولا يمكن إنشاء مهمة معالجة جديدة.",
    );
  }
  if (
    (mode === "hard-jobs" || mode === "hard") &&
    subscription.usage.jobs >= subscription.usage.jobLimit
  ) {
    throw new UsageLimitError(
      "JOB_QUOTA_EXCEEDED",
      "وصلت إلى الحد الأقصى لمهام هذه الفترة.",
    );
  }
  if (
    mode === "hard" &&
    subscription.usage.processingMinutes >=
      subscription.usage.processingMinuteLimit
  ) {
    throw new UsageLimitError(
      "PROCESSING_MINUTES_QUOTA_EXCEEDED",
      "وصلت إلى الحد الأقصى لدقائق المعالجة لهذه الفترة.",
    );
  }
}
