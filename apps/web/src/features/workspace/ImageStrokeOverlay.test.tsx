/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageStrokeOverlay } from "./ImageStrokeOverlay";

afterEach(cleanup);

describe("ImageStrokeOverlay", () => {
  it("commits a one-point brush dab on a pointer click", () => {
    const onCommit = vi.fn();
    const { container } = render(
      <ImageStrokeOverlay
        strokes={[]}
        activePrompt="exclude"
        brushSize={16}
        onCommit={onCommit}
        onErase={vi.fn()}
        showRefinement={false}
        disabled={false}
      />,
    );
    const overlay = container.querySelector<SVGSVGElement>(
      ".guidance-overlay",
    );
    expect(overlay).not.toBeNull();
    vi.spyOn(overlay!, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      right: 200,
      bottom: 100,
      left: 0,
      width: 200,
      height: 100,
      toJSON: () => ({}),
    });
    Object.defineProperties(overlay!, {
      setPointerCapture: { value: vi.fn() },
      hasPointerCapture: { value: vi.fn(() => true) },
      releasePointerCapture: { value: vi.fn() },
    });

    fireEvent.pointerDown(overlay!, {
      pointerId: 1,
      clientX: 50,
      clientY: 75,
    });
    fireEvent.pointerUp(overlay!, {
      pointerId: 1,
      clientX: 50,
      clientY: 75,
    });

    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: "exclude",
      size: 16,
      points: [{ x: 0.25, y: 0.75 }],
    }));
  });
});
