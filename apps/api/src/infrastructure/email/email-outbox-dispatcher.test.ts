import { describe, expect, it, vi } from "vitest";
import { EmailOutboxDispatcher } from "./email-outbox-dispatcher.js";
import type { EmailOutboxRepository } from "../postgres/postgres-email-outbox.js";

describe("email outbox dispatcher", () => {
  it("marks a claimed password reset as sent", async () => {
    const outbox = fakeOutbox();
    const sender = { sendPasswordReset: vi.fn(async () => undefined) };
    const events = vi.fn();
    const dispatcher = new EmailOutboxDispatcher(
      outbox,
      sender,
      events,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );

    await expect(dispatcher.runOnce()).resolves.toBe(true);
    expect(sender.sendPasswordReset).toHaveBeenCalledOnce();
    expect(outbox.markSent).toHaveBeenCalledOnce();
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "sent", errorCode: null }),
    );
  });

  it("schedules a sanitized retry after an SMTP failure", async () => {
    const outbox = fakeOutbox();
    const sender = {
      sendPasswordReset: vi.fn(async () => {
        throw new Error("provider secret and recipient details");
      }),
    };
    const events = vi.fn();
    const dispatcher = new EmailOutboxDispatcher(
      outbox,
      sender,
      events,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );

    await dispatcher.runOnce();
    expect(outbox.retryOrFail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "SMTP_DELIVERY_FAILED",
      "2026-08-01T12:00:30.000Z",
      "2026-08-01T12:00:00.000Z",
    );
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "retry" }),
    );
  });

  it("returns idle when there is no pending delivery", async () => {
    const outbox = fakeOutbox();
    vi.mocked(outbox.claimNext).mockResolvedValueOnce(null);
    const sender = { sendPasswordReset: vi.fn(async () => undefined) };

    await expect(
      new EmailOutboxDispatcher(outbox, sender).runOnce(),
    ).resolves.toBe(false);
    expect(sender.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("marks a delivery failed when retry attempts are exhausted", async () => {
    const outbox = fakeOutbox();
    vi.mocked(outbox.claimNext).mockResolvedValueOnce({
      id: crypto.randomUUID(),
      attempt: 8,
      maxAttempts: 8,
      message: {
        recipient: "owner@example.com",
        resetUrl: "https://studio.example.com/reset?token=secret",
        expiresAt: "2026-08-01T12:30:00.000Z",
      },
    });
    vi.mocked(outbox.markSent).mockResolvedValueOnce(false);
    vi.mocked(outbox.retryOrFail).mockResolvedValueOnce("failed");
    const events = vi.fn();
    const dispatcher = new EmailOutboxDispatcher(
      outbox,
      { sendPasswordReset: vi.fn(async () => undefined) },
      events,
      () => new Date("2026-08-01T12:00:00.000Z"),
    );

    await expect(dispatcher.runOnce()).resolves.toBe(true);
    expect(outbox.retryOrFail).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "SMTP_DELIVERY_FAILED",
      "2026-08-01T12:15:00.000Z",
      "2026-08-01T12:00:00.000Z",
    );
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "failed", attempt: 8 }),
    );
  });

  it("starts, drains an idle queue, and stops without leaving a timer", async () => {
    vi.useFakeTimers();
    try {
      const outbox = fakeOutbox();
      vi.mocked(outbox.claimNext).mockResolvedValue(null);
      const dispatcher = new EmailOutboxDispatcher(
        outbox,
        { sendPasswordReset: vi.fn(async () => undefined) },
      );

      dispatcher.start();
      dispatcher.start();
      await vi.advanceTimersByTimeAsync(0);
      await dispatcher.stop();

      expect(outbox.claimNext).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

function fakeOutbox(): EmailOutboxRepository {
  return {
    claimNext: vi.fn(async () => ({
      id: crypto.randomUUID(),
      attempt: 1,
      maxAttempts: 5,
      message: {
        recipient: "owner@example.com",
        resetUrl: "https://studio.example.com/reset?token=secret",
        expiresAt: "2026-08-01T12:30:00.000Z",
      },
    })),
    markSent: vi.fn(async () => true),
    retryOrFail: vi.fn(async (): Promise<"queued"> => "queued"),
  };
}
