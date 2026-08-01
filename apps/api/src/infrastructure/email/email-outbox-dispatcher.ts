import type { EmailSender } from "../../auth/email-sender.js";
import type { EmailOutboxRepository } from "../postgres/postgres-email-outbox.js";

export interface EmailDeliveryEvent {
  deliveryId: string;
  outcome: "sent" | "retry" | "failed";
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
      const saved = await this.outbox.markSent(
        delivery.id,
        this.#workerId,
        this.now().toISOString(),
      );
      if (!saved) throw new Error("Email delivery lease was lost.");
      this.onEvent({
        deliveryId: delivery.id,
        outcome: "sent",
        attempt: delivery.attempt,
        errorCode: null,
      });
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
      this.onEvent({
        deliveryId: delivery.id,
        outcome: status === "failed" ? "failed" : "retry",
        attempt: delivery.attempt,
        errorCode: "SMTP_DELIVERY_FAILED",
      });
    }
    return true;
  }

  private schedule(delay: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#running = this.drain()
        .catch(() => undefined)
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
