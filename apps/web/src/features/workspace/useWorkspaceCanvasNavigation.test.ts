/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateWorkspaceFitZoom,
  useWorkspaceCanvasNavigation,
} from "./useWorkspaceCanvasNavigation";

afterEach(cleanup);

describe("workspace canvas navigation", () => {
  it("fits the canvas within the padded viewport in five-percent steps", () => {
    expect(calculateWorkspaceFitZoom(
      { width: 832, height: 632 },
      { width: 800, height: 600 },
    )).toBe(100);
    expect(calculateWorkspaceFitZoom(
      { width: 432, height: 332 },
      { width: 800, height: 600 },
    )).toBe(50);
  });

  it("clamps invalid and extreme geometry to supported zoom bounds", () => {
    expect(calculateWorkspaceFitZoom(
      { width: 0, height: 0 },
      { width: 800, height: 600 },
    )).toBe(100);
    expect(calculateWorkspaceFitZoom(
      { width: 100, height: 100 },
      { width: 4_000, height: 4_000 },
    )).toBe(25);
    expect(calculateWorkspaceFitZoom(
      { width: 2_000, height: 2_000 },
      { width: 100, height: 100 },
    )).toBe(200);
  });

  it("implements Ctrl+0 without hijacking editable fields", () => {
    const onZoomChange = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceCanvasNavigation(onZoomChange, "source-1"),
    );
    const container = document.createElement("div");
    const canvas = document.createElement("div");
    canvas.className = "image-artboard";
    container.append(canvas);
    Object.defineProperties(container, {
      clientWidth: { value: 432 },
      clientHeight: { value: 332 },
    });
    Object.defineProperties(canvas, {
      offsetWidth: { value: 800 },
      offsetHeight: { value: 600 },
    });
    result.current.containerRef.current = container;

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", {
        key: "0",
        ctrlKey: true,
      }));
    });
    expect(onZoomChange).toHaveBeenCalledWith(50);

    const input = document.createElement("input");
    document.body.append(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", {
        key: "0",
        ctrlKey: true,
        bubbles: true,
      }));
    });
    expect(onZoomChange).toHaveBeenCalledOnce();
  });
});
