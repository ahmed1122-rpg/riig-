/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listWorkflowActivity,
  type WorkflowActivityFeed,
  type WorkflowActivityItem,
} from "../../lib/api";
import {
  ACTIVITY_POLL_INTERVAL_MS,
  CreatorActivityCenter,
} from "./CreatorActivityCenter";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>(
    "../../lib/api",
  );
  return { ...actual, listWorkflowActivity: vi.fn() };
});

const runningItem: WorkflowActivityItem = {
  id: "processing:job-1",
  kind: "processing",
  status: "running",
  project: { id: "project-1", name: "الشخصية الرئيسية", kind: "image" },
  sourceVersionId: "source-1",
  jobId: "job-1",
  progress: 42,
  errorCode: null,
  recommendedAction: "open-project",
  createdAt: "2026-08-04T08:00:00.000Z",
  updatedAt: "2026-08-04T08:05:00.000Z",
};

function activityFeed(
  items: WorkflowActivityItem[],
  nextCursor: string | null = null,
): WorkflowActivityFeed {
  return {
    items,
    summary: {
      active: items.filter((item) =>
        ["pending", "running"].includes(item.status),
      ).length,
      needsAttention: items.filter((item) => item.status === "attention").length,
      failed: items.filter((item) => item.status === "failed").length,
    },
    nextCursor,
    generatedAt: "2026-08-04T08:10:00.000Z",
  };
}

function renderActivity(
  overrides: Partial<React.ComponentProps<typeof CreatorActivityCenter>> = {},
) {
  const props: React.ComponentProps<typeof CreatorActivityCenter> = {
    authenticated: true,
    onRequireAuth: vi.fn(),
    onOpenProject: vi.fn(),
    onNavigateProjects: vi.fn(),
    onNavigateExports: vi.fn(),
    ...overrides,
  };
  return { view: render(<CreatorActivityCenter {...props} />), props };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe("CreatorActivityCenter", () => {
  it("shows loading and does not request protected data for guests", async () => {
    vi.mocked(listWorkflowActivity).mockReturnValue(new Promise(() => undefined));
    const authenticated = renderActivity();
    expect(authenticated.view.getByText("جارٍ تحميل نشاطك")).toBeTruthy();
    await waitFor(() => expect(listWorkflowActivity).toHaveBeenCalledOnce());
    authenticated.view.unmount();

    const guest = renderActivity({ authenticated: false });
    expect(guest.view.getByText("سجّل الدخول لعرض نشاطك")).toBeTruthy();
    expect(listWorkflowActivity).toHaveBeenCalledOnce();
  });

  it("shows an initial error, retries, then renders the empty state", async () => {
    vi.mocked(listWorkflowActivity)
      .mockRejectedValueOnce(new Error("الخدمة غير متاحة مؤقتًا"))
      .mockResolvedValueOnce(activityFeed([]));
    const { view } = renderActivity();

    expect(await view.findByText("تعذر تحميل النشاط")).toBeTruthy();
    expect(view.getByText("الخدمة غير متاحة مؤقتًا")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "إعادة المحاولة" }));

    expect(await view.findByText("لا يوجد نشاط إنتاج بعد")).toBeTruthy();
    expect(listWorkflowActivity).toHaveBeenCalledTimes(2);
  });

  it("routes project review and completed exports to their primary actions", async () => {
    const reviewItem: WorkflowActivityItem = {
      ...runningItem,
      id: "project:project-2",
      kind: "review",
      status: "attention",
      project: { id: "project-2", name: "كتاب التدريب", kind: "book" },
      sourceVersionId: "source-2",
      jobId: null,
      progress: 100,
      recommendedAction: "review-project",
      updatedAt: "2026-08-04T08:09:00.000Z",
    };
    const exportItem: WorkflowActivityItem = {
      ...runningItem,
      id: "export:export-1",
      kind: "export",
      status: "succeeded",
      progress: 100,
      recommendedAction: "view-exports",
      updatedAt: "2026-08-04T08:08:00.000Z",
    };
    vi.mocked(listWorkflowActivity).mockResolvedValue(
      activityFeed([reviewItem, exportItem]),
    );
    const onOpenProject = vi.fn();
    const onNavigateExports = vi.fn();
    const { view } = renderActivity({ onOpenProject, onNavigateExports });

    fireEvent.click(await view.findByRole("button", { name: "بدء المراجعة" }));
    expect(view.container.querySelector(".activity-summary .is-attention dd")?.textContent)
      .toBe("1");
    fireEvent.click(view.getByRole("button", { name: "عرض التصدير" }));
    expect(onOpenProject).toHaveBeenCalledWith(reviewItem);
    expect(onNavigateExports).toHaveBeenCalledOnce();
  });

  it("presents failure codes as secondary diagnostics", async () => {
    const failedItem: WorkflowActivityItem = {
      ...runningItem,
      status: "failed",
      progress: null,
      errorCode: "OCR_FAILED",
      recommendedAction: "open-project",
    };
    vi.mocked(listWorkflowActivity).mockResolvedValue(activityFeed([failedItem]));
    const { view } = renderActivity();

    const error = await view.findByText("تحتاج قراءة النص إلى مراجعة داخل المشروع.");
    expect(error.textContent).not.toContain("OCR_FAILED");
    expect(view.container.querySelector(".activity-row__error code")?.textContent)
      .toBe("OCR_FAILED");
  });

  it("appends pages without duplicating an activity item", async () => {
    const older = {
      ...runningItem,
      id: "project:project-older",
      status: "succeeded" as const,
      updatedAt: "2026-08-04T07:00:00.000Z",
    };
    const oldest = {
      ...older,
      id: "project:project-oldest",
      updatedAt: "2026-08-04T06:00:00.000Z",
    };
    vi.mocked(listWorkflowActivity)
      .mockResolvedValueOnce(activityFeed([runningItem, older], "opaque-cursor"))
      .mockResolvedValueOnce(activityFeed([older, oldest]));
    const { view } = renderActivity();

    fireEvent.click(await view.findByRole("button", { name: "تحميل المزيد" }));
    await waitFor(() =>
      expect(view.container.querySelectorAll("[data-testid^='activity-']"))
        .toHaveLength(3),
    );
    expect(listWorkflowActivity).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "opaque-cursor" }),
    );
  });

  it("keeps the current page when pagination fails and retries the same cursor", async () => {
    vi.mocked(listWorkflowActivity)
      .mockResolvedValueOnce(activityFeed([runningItem], "cursor-invalid"))
      .mockRejectedValueOnce(
        new Error("مؤشر صفحة النشاط غير صالح. حدّث الصفحة ثم أعد المحاولة."),
      )
      .mockResolvedValueOnce(activityFeed([]));
    const { view } = renderActivity();

    fireEvent.click(await view.findByRole("button", { name: "تحميل المزيد" }));
    expect(await view.findByText(/مؤشر صفحة النشاط غير صالح/)).toBeTruthy();
    expect(view.getByTestId(`activity-${runningItem.id}`)).toBeTruthy();

    fireEvent.click(view.getByRole("button", { name: "إعادة المحاولة" }));
    await waitFor(() => expect(listWorkflowActivity).toHaveBeenCalledTimes(3));
    expect(listWorkflowActivity).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ cursor: "cursor-invalid" }),
    );
  });

  it("keeps the furthest append frontier after a first-page refresh", async () => {
    vi.useFakeTimers();
    const second = {
      ...runningItem,
      id: "project:project-second",
      status: "succeeded" as const,
      updatedAt: "2026-08-04T08:04:00.000Z",
    };
    const older = {
      ...second,
      id: "project:project-older",
      updatedAt: "2026-08-04T07:00:00.000Z",
    };
    const oldest = {
      ...second,
      id: "project:project-oldest",
      updatedAt: "2026-08-04T06:00:00.000Z",
    };
    vi.mocked(listWorkflowActivity)
      .mockResolvedValueOnce(activityFeed([runningItem, second], "page-2"))
      .mockResolvedValueOnce(activityFeed([second, older], "page-3"))
      .mockResolvedValueOnce(
        activityFeed([runningItem, second], "refreshed-page-2"),
      )
      .mockResolvedValueOnce(activityFeed([older, oldest]));

    const { view } = renderActivity();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(view.getByRole("button", { name: "تحميل المزيد" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.container.querySelectorAll("[data-testid^='activity-']"))
      .toHaveLength(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_INTERVAL_MS);
    });
    expect(listWorkflowActivity).toHaveBeenNthCalledWith(
      3,
      expect.not.objectContaining({ cursor: expect.anything() }),
    );

    fireEvent.click(view.getByRole("button", { name: "تحميل المزيد" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(listWorkflowActivity).toHaveBeenNthCalledWith(
      4,
      expect.objectContaining({ cursor: "page-3" }),
    );
    expect(view.container.querySelectorAll("[data-testid^='activity-']"))
      .toHaveLength(4);
  });

  it("polls active work only while the document is visible", async () => {
    vi.useFakeTimers();
    let visibility: DocumentVisibilityState = "visible";
    const ownVisibility = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibility,
    });
    vi.mocked(listWorkflowActivity).mockResolvedValue(activityFeed([runningItem]));

    try {
      const { view } = renderActivity();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(view.getByTestId(`activity-${runningItem.id}`)).toBeTruthy();
      expect(listWorkflowActivity).toHaveBeenCalledOnce();

      visibility = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_INTERVAL_MS * 2);
      });
      expect(listWorkflowActivity).toHaveBeenCalledOnce();

      visibility = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(listWorkflowActivity).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ACTIVITY_POLL_INTERVAL_MS);
      });
      expect(listWorkflowActivity).toHaveBeenCalledTimes(3);
    } finally {
      if (ownVisibility) {
        Object.defineProperty(document, "visibilityState", ownVisibility);
      } else {
        Reflect.deleteProperty(document, "visibilityState");
      }
    }
  });
});
