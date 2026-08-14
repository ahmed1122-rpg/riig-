/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteEmptyProject, listProjects } from "../../lib/api";
import { ProjectsView } from "./ProjectsView";

vi.mock("../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status = 500;
  },
  deleteEmptyProject: vi.fn(),
  listProjects: vi.fn(),
  listSourceVersions: vi.fn(),
}));

vi.mock("../../shared/useConfirmation", () => ({
  useConfirmation: () => ({
    requestConfirmation: vi.fn().mockResolvedValue(true),
    confirmationDialog: null,
  }),
}));

function project(status: string) {
  return {
    id: "project-1",
    name: "مشروع تجريبي",
    kind: "image",
    status,
    currentSourceVersionId: status === "draft" ? null : "source-1",
    currentSourceVersionNumber: status === "draft" ? null : 1,
    reviewApproval: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("ProjectsView", () => {
  it("polls while a project is active and stops on a reviewable state", async () => {
    vi.useFakeTimers();
    vi.mocked(listProjects)
      .mockResolvedValueOnce([project("processing")] as never)
      .mockResolvedValueOnce([project("needs_review")] as never);
    render(
      <ProjectsView
        demoState="ready"
        authenticated
        onRequireAuth={vi.fn()}
        onOpenWorkspace={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(listProjects).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(listProjects).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(listProjects).toHaveBeenCalledTimes(2);
  });

  it("offers server-verified deletion only for an empty draft", async () => {
    vi.mocked(listProjects).mockResolvedValue([project("draft")] as never);
    vi.mocked(deleteEmptyProject).mockResolvedValue(undefined);
    render(
      <ProjectsView
        demoState="ready"
        authenticated
        onRequireAuth={vi.fn()}
        onOpenWorkspace={vi.fn()}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "حذف" }));

    await waitFor(() => expect(deleteEmptyProject).toHaveBeenCalledOnce());
    expect(deleteEmptyProject).toHaveBeenCalledWith("project-1");
    expect(screen.queryByText("مشروع تجريبي")).toBeNull();
  });

  it("explains an empty filtered result and clears every filter", async () => {
    vi.mocked(listProjects).mockResolvedValue([project("completed")] as never);
    render(
      <ProjectsView
        demoState="ready"
        authenticated
        onRequireAuth={vi.fn()}
        onOpenWorkspace={vi.fn()}
      />,
    );

    fireEvent.change(await screen.findByRole("searchbox"), {
      target: { value: "لا-يطابق-أي-مشروع" },
    });
    const clear = await screen.findByRole("button", {
      name: "مسح عوامل التصفية",
    });
    fireEvent.click(clear);

    expect(await screen.findByText("مشروع تجريبي")).toBeTruthy();
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
  });
});
