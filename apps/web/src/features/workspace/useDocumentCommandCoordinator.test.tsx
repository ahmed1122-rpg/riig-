// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  StaleDocumentCommandError,
  useDocumentCommandCoordinator,
} from "./useDocumentCommandCoordinator";

describe("useDocumentCommandCoordinator", () => {
  it("flushes once per command and serializes mutations", async () => {
    const flush = vi.fn().mockResolvedValue(7);
    const busy = { current: false };
    const order: string[] = [];
    const { result } = renderHook(() => useDocumentCommandCoordinator({
      projectId: "project",
      sourceVersionId: "source",
      flushLayerReview: flush,
      saveInFlightRef: busy,
    }));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const first = result.current.run(async ({ baseRevision }) => {
      order.push(`first:${baseRevision}`);
      await gate;
      order.push("first:done");
      return 1;
    });
    const second = result.current.run(async ({ baseRevision }) => {
      order.push(`second:${baseRevision}`);
      return 2;
    });
    await act(async () => { release(); });
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual(["first:7", "first:done", "second:7"]);
    expect(flush).toHaveBeenCalledTimes(2);
  });

  it("does not adopt a result after the source identity changes", async () => {
    const flush = vi.fn().mockResolvedValue(2);
    const busy = { current: false };
    let sourceVersionId = "source-1";
    const { result, rerender } = renderHook(() =>
      useDocumentCommandCoordinator({
        projectId: "project",
        sourceVersionId,
        flushLayerReview: flush,
        saveInFlightRef: busy,
      }),
    );
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const pending = result.current.run(async () => {
      await gate;
      return "old";
    });
    sourceVersionId = "source-2";
    rerender();
    finish();
    await expect(pending).rejects.toBeInstanceOf(StaleDocumentCommandError);
  });

  it("allows commands that intentionally replace the source identity", async () => {
    const busy = { current: false };
    let sourceVersionId = "source-1";
    const { result, rerender } = renderHook(() =>
      useDocumentCommandCoordinator({
        projectId: "project",
        sourceVersionId,
        flushLayerReview: vi.fn().mockResolvedValue(2),
        saveInFlightRef: busy,
      }),
    );
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const pending = result.current.run(async () => {
      await gate;
      return "source-2";
    }, { allowIdentityChange: true });
    sourceVersionId = "source-2";
    rerender();
    finish();
    await expect(pending).resolves.toBe("source-2");
  });
});
