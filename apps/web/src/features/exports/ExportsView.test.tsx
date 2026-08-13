/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  listExports,
  listProjects,
  type ExportSummary,
  type ProjectSummary,
} from "../../lib/api";
import { ExportsView } from "./ExportsView";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>(
    "../../lib/api",
  );
  return { ...actual, listExports: vi.fn(), listProjects: vi.fn() };
});

const failedExport: ExportSummary = {
  id: "export-12345678",
  projectId: "project-1",
  sourceVersionId: "source-2",
  documentRevision: 4,
  projectKind: "image",
  format: "psd",
  scope: "full-document",
  scale: 1,
  colorProfile: "sRGB",
  namingPresetId: "character-basic",
  status: "failed",
  progress: 64,
  attempt: 3,
  maxAttempts: 3,
  errorCode: "EXPORT_WORKER_FAILED",
  createdAt: "2026-08-04T08:00:00.000Z",
  updatedAt: "2026-08-04T08:01:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExportsView failed export recovery", () => {
  it("explains the failure and routes the user to the owning project", async () => {
    vi.mocked(listExports).mockResolvedValue([failedExport]);
    const project: ProjectSummary = {
      id: "project-1",
      name: "الشخصية الرئيسية",
      kind: "image",
      status: "completed",
      currentSourceVersionId: "source-current",
      currentSourceVersionNumber: 5,
      reviewApproval: null,
      createdAt: "2026-08-04T07:00:00.000Z",
      updatedAt: "2026-08-04T08:00:00.000Z",
    };
    vi.mocked(listProjects).mockResolvedValue([project]);
    const onOpenProject = vi.fn();
    const view = render(
      <ExportsView
        authenticated
        onRequireAuth={vi.fn()}
        onCreateProject={vi.fn()}
        onViewProjects={vi.fn()}
        onOpenProject={onOpenProject}
        onNotify={vi.fn()}
      />,
    );

    await waitFor(() =>
      expect(view.container.querySelector(".export-failure-message")?.textContent)
        .toContain("تعذر إكمال محاولة التصدير"),
    );
    expect(
      view.container.querySelector(".export-failure-message > span")
        ?.textContent,
    ).not.toContain("EXPORT_WORKER_FAILED");
    expect(
      view.container.querySelector(".export-failure-message code")?.textContent,
    ).toBe("EXPORT_WORKER_FAILED");

    fireEvent.click(view.getByRole("button", { name: "فتح المشروع" }));
    await waitFor(() => expect(onOpenProject).toHaveBeenCalledWith(project));
  });

  it("presents an expired artifact as expired and offers recovery", async () => {
    vi.mocked(listExports).mockResolvedValue([
      {
        ...failedExport,
        status: "ready",
        progress: 100,
        errorCode: null,
        artifact: {
          filename: "expired.psd",
          sizeBytes: 1_024,
          sha256: "a".repeat(64),
          expiresAt: "2020-01-01T00:00:00.000Z",
        },
      },
    ]);
    const view = render(
      <ExportsView
        authenticated
        onRequireAuth={vi.fn()}
        onCreateProject={vi.fn()}
        onViewProjects={vi.fn()}
        onOpenProject={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    expect(await view.findByText("انتهت الصلاحية")).toBeTruthy();
    expect(
      view.getByRole("button", { name: "فتح المشروع وإعادة التصدير" }),
    ).toBeTruthy();
    expect(
      (view.getByRole("button", {
        name: "انتهت صلاحية رابط التنزيل",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
