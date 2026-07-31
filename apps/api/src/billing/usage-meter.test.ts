import { describe, expect, it } from "vitest";
import { InMemoryBillingRepository } from "./billing-repository.js";
import {
  RepositoryUsageMeter,
  UsageLimitError,
} from "./usage-meter.js";

describe("RepositoryUsageMeter", () => {
  it("serializes concurrent reservations and enforces the starter job limit", async () => {
    const repository = new InMemoryBillingRepository();
    const meter = new RepositoryUsageMeter(
      repository,
      "hard-jobs",
      () => new Date("2026-07-28T12:00:00.000Z"),
    );
    const userId = crypto.randomUUID();
    const reservations = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        meter.reserveJob(userId, crypto.randomUUID()),
      ),
    );

    expect(
      reservations.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(5);
    expect(
      reservations.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof UsageLimitError &&
          result.reason.code === "JOB_QUOTA_EXCEEDED",
      ),
    ).toHaveLength(5);
    expect((await repository.findSubscription(userId))?.usage.jobs).toBe(5);
  });

  it("records each processing attempt once and releases failed reservations", async () => {
    const repository = new InMemoryBillingRepository();
    const meter = new RepositoryUsageMeter(repository, "shadow");
    const userId = crypto.randomUUID();
    const jobId = crypto.randomUUID();

    await Promise.all([
      meter.reserveJob(userId, jobId),
      meter.reserveJob(userId, jobId),
    ]);
    await Promise.all([
      meter.recordProcessingSeconds(jobId, 1, 30),
      meter.recordProcessingSeconds(jobId, 1, 30),
    ]);
    expect((await repository.findSubscription(userId))?.usage).toMatchObject({
      jobs: 1,
      processingMinutes: 0.5,
    });

    await Promise.all([meter.releaseJob(jobId), meter.releaseJob(jobId)]);
    expect((await repository.findSubscription(userId))?.usage.jobs).toBe(0);
  });
});
