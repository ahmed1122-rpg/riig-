/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  SourceVersionRestoreResult,
  SourceVersionSummary,
} from "../../lib/api";
import { useWorkspaceSourceRestoration } from "./useWorkspaceSourceRestoration";
import { loadWorkspaceProjectDocument } from "./workspaceDocument";

vi.mock("../../lib/api", () => ({
  ApiError: class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
  reanalyzePdfSource: vi.fn(),
}));

vi.mock("./workspaceDocument", () => ({
  loadWorkspaceProjectDocument: vi.fn(),
}));

const restoreResult = {
  project: {
    id: "project-1",
    currentSourceVersionId: "source-2",
  },
} as SourceVersionRestoreResult;

const version = {
  id: "source-2",
  versionNumber: 2,
  filename: "restored.png",
  sha256: "b".repeat(64),
  status: "ready",
} as SourceVersionSummary;

function makeOptions() {
  return {
    mode: "image" as const,
    pdfMode: "lines" as const,
    replaceLayerAssetUrls: vi.fn(),
    applyPreparedDocument: vi.fn(),
    resetLayerSelection: vi.fn(),
    adoptSavedReview: vi.fn(),
    adoptDocument: vi.fn(),
    setProcessing: vi.fn(),
    setSourceVersionId: vi.fn(),
    setSourceVersion: vi.fn(),
    setSourceName: vi.fn(),
    setSourceHash: vi.fn(),
    setSourcePreviewUrl: vi.fn(),
    setUploadState: vi.fn(),
    setUploadProgress: vi.fn(),
    setUploadError: vi.fn(),
    setUploadDetailsOpen: vi.fn(),
    setGuidanceRevision: vi.fn(),
    onNotify: vi.fn(),
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useWorkspaceSourceRestoration", () => {
  it("commits source identity only after the restored document is ready", async () => {
    const options = makeOptions();
    vi.mocked(loadWorkspaceProjectDocument).mockResolvedValue({
      document: {
        revision: 3,
        guidance: { revision: 2 },
      },
      preparedLayers: [],
      previewUrls: [],
    } as never);
    const { result } = renderHook(() =>
      useWorkspaceSourceRestoration(options),
    );

    await act(async () => {
      await result.current(restoreResult, version);
    });

    expect(options.applyPreparedDocument).toHaveBeenCalledTimes(1);
    expect(options.setSourceVersionId).toHaveBeenCalledWith("source-2");
    expect(
      options.applyPreparedDocument.mock.invocationCallOrder[0],
    ).toBeLessThan(options.setSourceVersionId.mock.invocationCallOrder[0]!);
  });

  it("rejects hydration failure without publishing the new source identity", async () => {
    const options = makeOptions();
    vi.mocked(loadWorkspaceProjectDocument).mockRejectedValue(
      new Error("hydration failed"),
    );
    const { result } = renderHook(() =>
      useWorkspaceSourceRestoration(options),
    );

    await expect(
      act(async () => result.current(restoreResult, version)),
    ).rejects.toThrow("hydration failed");

    expect(options.setSourceVersionId).not.toHaveBeenCalled();
    expect(options.setSourceName).not.toHaveBeenCalled();
    expect(options.setUploadState).toHaveBeenLastCalledWith("error");
    expect(options.setUploadDetailsOpen).toHaveBeenCalledWith(true);
  });
});
