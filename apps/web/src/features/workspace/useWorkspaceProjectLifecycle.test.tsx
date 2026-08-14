/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProject } from "../../lib/api";
import { useWorkspaceProjectLifecycle } from "./useWorkspaceProjectLifecycle";
import { loadWorkspaceProjectDocument } from "./workspaceDocument";

vi.mock("../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(_code: string, message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  getProject: vi.fn(),
}));

vi.mock("./workspaceDocument", () => ({
  loadWorkspaceProjectDocument: vi.fn(),
}));

vi.mock("./useWorkspaceUpload", () => ({
  useWorkspaceUpload: () => ({
    chooseSource: vi.fn(),
    cancelUpload: vi.fn(),
  }),
}));

function project(status: string, kind: "image" | "book" = "image") {
  return {
    id: "project-1",
    name: "مشروع محفوظ",
    kind,
    status,
    currentSourceVersionId:
      status === "draft" ? null : "source-1",
    currentSourceVersionNumber: status === "draft" ? null : 1,
  };
}

function makeOptions() {
  return {
    mode: "image" as const,
    maxUploadBytes: 1_000_000,
    authenticated: true,
    persistedSource: false,
    sourceName: "مشروع محفوظ",
    pdfMode: "lines" as const,
    initialProject: {
      id: "project-1",
      name: "مشروع محفوظ",
      currentSourceVersionId: null,
      currentSourceVersionNumber: null,
    },
    onRequireAuth: vi.fn(),
    onNotify: vi.fn(),
    requestConfirmation: vi.fn().mockResolvedValue(true),
    commandCoordinator: {
      run: async <T,>(command: (context: { baseRevision: number | undefined }) => Promise<T>) =>
        command({ baseRevision: undefined }),
    },
    adoptSavedReview: vi.fn(),
    resetLayerSelection: vi.fn(),
    setImageLayers: vi.fn(),
    setBookLayers: vi.fn(),
    setProjectId: vi.fn(),
    setSourceVersionId: vi.fn(),
    setPendingUploadId: vi.fn(),
    setPendingSourceVersionId: vi.fn(),
    setProcessingJobId: vi.fn(),
    setSourceHash: vi.fn(),
    setSourcePreviewUrl: vi.fn(),
    setImageCanvasSize: vi.fn(),
    setImagePreparation: vi.fn(),
    setOcrReview: vi.fn(),
    setGuidanceRevision: vi.fn(),
    setSourceVersion: vi.fn(),
    setSourceName: vi.fn(),
    setUploadState: vi.fn(),
    setUploadProgress: vi.fn(),
    setUploadError: vi.fn(),
    setUploadDetailsOpen: vi.fn(),
    setPdfPages: vi.fn(),
    setActivePdfPage: vi.fn(),
    setPdfPageSize: vi.fn(),
    setPdfPageCount: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useWorkspaceProjectLifecycle", () => {
  it("reopens an empty draft without trying to hydrate a missing document", async () => {
    const options = makeOptions();
    vi.mocked(getProject).mockResolvedValue(project("draft") as never);
    renderHook(() => useWorkspaceProjectLifecycle(options));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadWorkspaceProjectDocument).not.toHaveBeenCalled();
    expect(options.setProjectId).toHaveBeenCalledWith("project-1");
    expect(options.setUploadState).toHaveBeenLastCalledWith("empty");
  });

  it("polls an active project and hydrates it when processing completes", async () => {
    vi.useFakeTimers();
    const options = makeOptions();
    vi.mocked(getProject)
      .mockResolvedValueOnce(project("processing") as never)
      .mockResolvedValueOnce(project("needs_review") as never);
    vi.mocked(loadWorkspaceProjectDocument).mockResolvedValue({
      document: {
        sourceVersionId: "source-1",
        revision: 2,
        guidance: { revision: 1 },
        width: 100,
        height: 100,
      },
      preparedLayers: [],
      previewUrls: [],
    } as never);
    renderHook(() => useWorkspaceProjectLifecycle(options));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(loadWorkspaceProjectDocument).not.toHaveBeenCalled();
    expect(options.setUploadProgress).toHaveBeenCalledWith(80);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500);
    });

    expect(getProject).toHaveBeenCalledTimes(2);
    expect(loadWorkspaceProjectDocument).toHaveBeenCalledOnce();
    expect(options.setSourceVersionId).toHaveBeenCalledWith("source-1");
    expect(options.setUploadState).toHaveBeenLastCalledWith("ready");
  });

  it("fails closed when a deep link requests the wrong project mode", async () => {
    const options = makeOptions();
    vi.mocked(getProject).mockResolvedValue(
      project("needs_review", "book") as never,
    );
    renderHook(() => useWorkspaceProjectLifecycle(options));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadWorkspaceProjectDocument).not.toHaveBeenCalled();
    expect(options.setSourceVersionId).not.toHaveBeenCalled();
    expect(options.setUploadState).toHaveBeenLastCalledWith("error");
    expect(options.setUploadDetailsOpen).toHaveBeenCalledWith(true);
  });
});
