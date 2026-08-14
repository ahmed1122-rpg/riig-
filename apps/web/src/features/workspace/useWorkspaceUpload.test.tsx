/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAndUploadSource } from "../../lib/api";
import type { DocumentCommandCoordinator } from "./useDocumentCommandCoordinator";
import { useWorkspaceUpload } from "./useWorkspaceUpload";

vi.mock("../../lib/api", () => ({
  ApiError: class ApiError extends Error {},
  createAndUploadSource: vi.fn(),
}));

vi.mock("./workspaceDocument", () => ({
  isAcceptedFile: () => true,
  loadRasterLayerPreviews: vi.fn().mockResolvedValue({
    previews: new Map(),
    urls: [],
  }),
  toWorkspaceLayers: vi.fn().mockReturnValue([]),
}));

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function uploadResult(sourceVersionId: string) {
  return {
    projectId: "project-1",
    sourceVersionId,
    sourceVersionNumber: 1,
    sha256: "a".repeat(64),
    document: {
      schemaVersion: "1.0",
      projectId: "project-1",
      sourceVersionId,
      revision: 1,
      generatedAt: "2026-08-12T00:00:00.000Z",
      width: 100,
      height: 100,
      colorSpace: "sRGB",
      layers: [],
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useWorkspaceUpload", () => {
  it("lets only the latest overlapping upload adopt workspace state", async () => {
    const first = deferred<ReturnType<typeof uploadResult>>();
    const second = deferred<ReturnType<typeof uploadResult>>();
    vi.mocked(createAndUploadSource)
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);
    const onDocumentReady = vi.fn();
    const setSourceName = vi.fn();
    const commandCoordinator = {
      run: async <T,>(
        command: (context: { baseRevision: number | undefined }) => Promise<T>,
      ) => command({ baseRevision: 3 }),
    } satisfies DocumentCommandCoordinator;
    const coordinatorRun = vi.spyOn(commandCoordinator, "run");
    const options = {
      mode: "image" as const,
      maxUploadBytes: 1_000_000,
      authenticated: true,
      persistedSource: true,
      sourceName: "original.png",
      pdfMode: "lines" as const,
      commandCoordinator,
      onRequireAuth: vi.fn(),
      onNotify: vi.fn(),
      confirmSourceReplacement: vi.fn().mockResolvedValue(true),
      onLayerAssetUrls: vi.fn(),
      onLifecycleUpdate: vi.fn(),
      onDocumentReady,
      setSourceName,
      setUploadState: vi.fn(),
      setUploadProgress: vi.fn(),
      setUploadError: vi.fn(),
      setUploadDetailsOpen: vi.fn(),
    };
    const { result } = renderHook(() => useWorkspaceUpload(options));
    const firstFile = new File(["first"], "first.png", {
      type: "image/png",
    });
    const secondFile = new File(["second"], "second.png", {
      type: "image/png",
    });
    let firstCall!: Promise<void>;
    let secondCall!: Promise<void>;

    await act(async () => {
      firstCall = result.current.chooseSource(firstFile);
      await Promise.resolve();
    });
    await act(async () => {
      secondCall = result.current.chooseSource(secondFile);
      await Promise.resolve();
    });

    const firstSignal =
      vi.mocked(createAndUploadSource).mock.calls[0]?.[2]?.signal;
    expect(firstSignal?.aborted).toBe(true);

    await act(async () => {
      second.resolve(uploadResult("source-2"));
      await secondCall;
    });
    await act(async () => {
      first.resolve(uploadResult("source-1"));
      await firstCall;
    });

    expect(onDocumentReady).toHaveBeenCalledTimes(1);
    expect(onDocumentReady).toHaveBeenCalledWith(
      secondFile,
      expect.objectContaining({ sourceVersionId: "source-2" }),
      [],
    );
    expect(setSourceName).not.toHaveBeenLastCalledWith("original.png");
    expect(coordinatorRun).toHaveBeenCalledWith(
      expect.any(Function),
      { flush: true, allowIdentityChange: true },
    );
  });
});
