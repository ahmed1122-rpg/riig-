/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DragEvent } from "react";
import { useWorkspaceFileDrop } from "./useWorkspaceFileDrop";

afterEach(cleanup);

function fileDrag(files: File[]) {
  return {
    preventDefault: vi.fn(),
    dataTransfer: { types: ["Files"], files, dropEffect: "none" },
  } as unknown as DragEvent<HTMLElement>;
}

describe("workspace file drop", () => {
  it("shows the overlay and forwards exactly one dropped file", () => {
    const onFile = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileDrop(onFile, vi.fn()));
    const file = new File(["pdf"], "source.pdf", { type: "application/pdf" });

    act(() => result.current.onDragEnter(fileDrag([file])));
    expect(result.current.dragActive).toBe(true);
    act(() => result.current.onDrop(fileDrag([file])));
    expect(result.current.dragActive).toBe(false);
    expect(onFile).toHaveBeenCalledWith(file);
  });

  it("rejects a multi-file drop", () => {
    const onReject = vi.fn();
    const { result } = renderHook(() => useWorkspaceFileDrop(vi.fn(), onReject));
    act(() => result.current.onDrop(fileDrag([
      new File(["a"], "a.pdf"),
      new File(["b"], "b.pdf"),
    ])));
    expect(onReject).toHaveBeenCalledWith("أسقط ملف مصدر واحدًا فقط في كل مرة.");
  });
});
