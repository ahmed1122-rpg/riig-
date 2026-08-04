import type { EmailSender } from "../../auth/email-sender.js";
import type { EmailOutboxRepository } from "../postgres/postgres-email-outbox.js";

export interface EmailDeliveryEvent {
  deliveryId: string;
  outcome: "sent" | "retry" | "failed" | "lease_lost";
  attempt: number;
  errorCode: string | null;
}

export class EmailOutboxDispatcher {
  readonly #workerId = `api-email-${crypto.randomUUID()}`;
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<void> | null = null;
  #stopped = true;

  constructor(
    private readonly outbox: EmailOutboxRepository,
    private readonly sender: EmailSender,
    private readonly onEvent: (event: EmailDeliveryEvent) => void = () => {},
    private readonly now: () => Date = () => new Date(),
    private readonly pollMilliseconds = 1_000,
    private readonly onCycleError: (error: unknown) => void = () => {},
  ) {}

  start(): void {
    if (!this.#stopped) return;
    this.#stopped = false;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#running;
  }

  async runOnce(): Promise<boolean> {
    const now = this.now();
    const delivery = await this.outbox.claimNext(
      this.#workerId,
      now.toISOString(),
      new Date(now.getTime() + 60_000).toISOString(),
    );
    if (!delivery) return false;
    try {
      await this.sender.sendPasswordReset(delivery.message);
    } catch {
      const failedAt = this.now();
      const status = await this.outbox.retryOrFail(
        delivery.id,
        this.#workerId,
        "SMTP_DELIVERY_FAILED",
        new Date(
          failedAt.getTime() + retryDelayMilliseconds(delivery.attempt),
        ).toISOString(),
        failedAt.toISOString(),
      );
      this.emitEvent({
        deliveryId: delivery.id,
        outcome:
          status === null
            ? "lease_lost"
            : status === "failed"
              ? "failed"
              : "retry",
        attempt: delivery.attempt,
        errorCode:
          status === null
            ? "EMAIL_DELIVERY_LEASE_LOST"
            : "SMTP_DELIVERY_FAILED",
      });
      return true;
    }

    const saved = await this.outbox.markSent(
      delivery.id,
      this.#workerId,
      this.now().toISOString(),
    );
    this.emitEvent(
      saved
        ? {
            deliveryId: delivery.id,
            outcome: "sent",
            attempt: delivery.attempt,
            errorCode: null,
          }
        : {
            deliveryId: delivery.id,
            outcome: "lease_lost",
            attempt: delivery.attempt,
            errorCode: "EMAIL_DELIVERY_LEASE_LOST",
          },
    );
    return true;
  }

  private emitEvent(event: EmailDeliveryEvent): void {
    try {
      this.onEvent(event);
    } catch (error) {
      this.reportCycleError(error);
    }
  }

  private reportCycleError(error: unknown): void {
    try {
      this.onCycleError(error);
    } catch {
      // An observability callback must never change durable delivery state.
    }
  }

  private schedule(delay: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#running = this.drain()
        .catch((error: unknown) => this.reportCycleError(error))
        .finally(() => {
          this.#running = null;
          this.schedule(this.pollMilliseconds);
        });
    }, delay);
    this.#timer.unref();
  }

  private async drain(): Promise<void> {
    for (let count = 0; count < 20 && !this.#stopped; count += 1) {
      if (!(await this.runOnce())) return;
    }
  }
}

function retryDelayMilliseconds(attempt: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}
