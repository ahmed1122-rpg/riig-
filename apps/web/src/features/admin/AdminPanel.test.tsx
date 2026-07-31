import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  AdminProcessingJob,
  AdminSystemStatus,
} from "../../lib/api";
import {
  DataFeedback,
  outcomeTone,
  Processing,
  Status,
  System,
} from "./AdminPanel";

const noop = () => undefined;
const timestamp = "2026-07-31T12:00:00.000Z";

const failedJob: AdminProcessingJob = {
  id: "00000000-0000-4000-8000-000000000101",
  projectId: "00000000-0000-4000-8000-000000000102",
  sourceVersionId: "00000000-0000-4000-8000-000000000103",
  projectKind: "book",
  options: {},
  status: "failed",
  progress: 40,
  attempt: 2,
  maxAttempts: 3,
  nextAttemptAt: timestamp,
  leaseOwner: null,
  leaseExpiresAt: null,
  errorCode: "OCR_FAILED",
  createdAt: timestamp,
  updatedAt: timestamp,
};

const healthySystem: AdminSystemStatus = {
  status: "ready",
  checkedAt: timestamp,
  workers: ["media", "document", "export"].map((workerType, index) => ({
    instanceId: `worker-${index}`,
    workerType: workerType as "media" | "document" | "export",
    releaseVersion: "test",
    concurrency: 1,
    lastSeenAt: timestamp,
    stale: false,
  })),
  queues: [
    {
      queue: "processing-document",
      queued: 0,
      active: 1,
      failed: 0,
      oldestQueuedSeconds: 4,
    },
  ],
  maintenance: {
    task: "retention",
    lastStartedAt: timestamp,
    lastSucceededAt: timestamp,
    lastFailedAt: null,
    lastError: null,
    stale: false,
  },
};

describe("admin operational views", () => {
  it("renders loading, error, empty, and neutral feedback", () => {
    expect(renderToStaticMarkup(<DataFeedback loading error={null} onRetry={noop} />)).toContain("جارٍ تحميل");
    expect(renderToStaticMarkup(<DataFeedback loading={false} error="offline" onRetry={noop} />)).toContain("offline");
    expect(renderToStaticMarkup(<DataFeedback loading={false} error={null} empty onRetry={noop} />)).toContain("لا توجد بيانات");
    expect(renderToStaticMarkup(<DataFeedback loading={false} error={null} onRetry={noop} />)).toBe("");
  });

  it("shows audited retry only to an administrator for a failed job", () => {
    const admin = renderToStaticMarkup(
      <Processing jobs={[failedJob]} query="OCR" onQuery={noop} loading={false} error={null} onRetry={noop} canRetry onRetryJob={noop} />,
    );
    const support = renderToStaticMarkup(
      <Processing jobs={[{ ...failedJob, status: "ready", errorCode: null }]} query="" onQuery={noop} loading={false} error={null} onRetry={noop} canRetry={false} onRetryJob={noop} />,
    );

    expect(admin).toContain("إعادة</button>");
    expect(admin).toContain("PDF");
    expect(support).not.toContain("إعادة</button>");
    expect(support).toContain("status--ready");
  });

  it("renders healthy, stale, and missing maintenance states", () => {
    const healthy = renderToStaticMarkup(
      <System data={healthySystem} loading={false} error={null} onRetry={noop} />,
    );
    const stale = renderToStaticMarkup(
      <System data={{ ...healthySystem, status: "degraded", maintenance: { ...healthySystem.maintenance!, stale: true, lastError: "cleanup failed" }, queues: [{ ...healthySystem.queues[0]!, failed: 1, oldestQueuedSeconds: 180 }] }} loading={false} error={null} onRetry={noop} />,
    );
    const missing = renderToStaticMarkup(
      <System data={{ ...healthySystem, maintenance: null, workers: [] }} loading={false} error={null} onRetry={noop} />,
    );

    expect(healthy).toContain("منتظم");
    expect(healthy).toContain("مستقرة");
    expect(stale).toContain("متأخر");
    expect(stale).toContain("cleanup failed");
    expect(missing).toContain("مفقود");
  });

  it("maps status and audit outcomes to visible tones", () => {
    expect(renderToStaticMarkup(<Status tone="review">review</Status>)).toContain("status--review");
    expect(outcomeTone("success")).toBe("ready");
    expect(outcomeTone("denied")).toBe("review");
    expect(outcomeTone("failed")).toBe("danger");
  });
});
