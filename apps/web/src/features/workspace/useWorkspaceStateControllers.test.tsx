// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Layer, ProjectMode } from "../../types";
import {
  useWorkspaceEditorState,
  useWorkspaceReviewState,
  useWorkspaceSourceState,
} from "./useWorkspaceStateControllers";

const layer: Layer = {
  id: "layer-1",
  name: "طبقة",
  kind: "body",
  visible: true,
  locked: false,
  opacity: 100,
  confidence: 96,
  color: "#3bb3a9",
};

const storedPreferences = new Map<string, string>();

describe("workspace state controllers", () => {
  beforeEach(() => {
    storedPreferences.clear();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storedPreferences.get(key) ?? null,
        setItem: (key: string, value: string) =>
          storedPreferences.set(key, value),
      },
    });
  });

  it("keeps layer selection consistent while switching review modes", () => {
    const { result, rerender } = renderHook(
      ({ mode }: { mode: ProjectMode }) => useWorkspaceReviewState(mode),
      { initialProps: { mode: "image" } },
    );

    act(() => result.current.setBookLayers([layer]));
    rerender({ mode: "book" });
    act(() => result.current.prepareMode("book"));

    expect(result.current.activeLayerId).toBe(layer.id);
    expect(result.current.selectedIds).toEqual([layer.id]);

    act(() => result.current.changeSelection([], ""));
    expect(result.current.activeLayerId).toBe("");
    expect(result.current.selectedIds).toEqual([]);
  });

  it("resets one source lifecycle as an atomic mode transition", () => {
    const { result } = renderHook(() => useWorkspaceSourceState("image"));

    act(() => {
      result.current.setProjectId("project-1");
      result.current.setSourceVersionId("source-1");
      result.current.setUploadState("ready");
      result.current.setSourceVersion(4);
      result.current.setPdfPages([
        { pageNumber: 1, width: 100, height: 200 },
      ]);
    });
    expect(result.current.persistedSource).toBe(true);

    act(() => result.current.resetForMode("book"));

    expect(result.current.persistedSource).toBe(false);
    expect(result.current.uploadState).toBe("empty");
    expect(result.current.sourceVersion).toBe(0);
    expect(result.current.pdfPages).toEqual([]);
    expect(result.current.sourceName).toContain("PDF");
  });

  it("owns editor preferences and transient mode feedback", () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(
      ({ mode }: { mode: ProjectMode }) => useWorkspaceEditorState(mode),
      { initialProps: { mode: "image" } },
    );

    expect(result.current.layerLoading).toBe(true);
    act(() => result.current.setPreviewBackground("checker"));
    act(() => result.current.resetForMode("book"));
    expect(result.current.previewBackground).toBe("white");

    rerender({ mode: "book" });
    act(() => vi.advanceTimersByTime(260));
    expect(result.current.layerLoading).toBe(false);
    unmount();
    vi.useRealTimers();
  });
});
