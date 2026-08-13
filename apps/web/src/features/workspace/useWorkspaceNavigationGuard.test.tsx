/** @vitest-environment jsdom */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceNavigationGuard } from "./useWorkspaceNavigationGuard";

afterEach(cleanup);

function Harness({
  hasUnsavedReview,
  flushLayerReview,
  hasUnsavedDraft = () => false,
  confirmDiscardDraft = async () => true,
  onNavigationGuardChange,
  onNotify,
}: {
  hasUnsavedReview: () => boolean;
  flushLayerReview: () => Promise<number>;
  hasUnsavedDraft?: () => boolean;
  confirmDiscardDraft?: () => Promise<boolean>;
  onNavigationGuardChange: (
    guard: (() => Promise<boolean>) | null,
  ) => void;
  onNotify: (message: string) => void;
}) {
  useWorkspaceNavigationGuard({
    hasUnsavedReview,
    flushLayerReview,
    hasUnsavedDraft,
    confirmDiscardDraft,
    onNavigationGuardChange,
    onNotify,
  });
  return null;
}

describe("useWorkspaceNavigationGuard", () => {
  it("allows clean navigation without starting a save", async () => {
    const flushLayerReview = vi.fn(async () => 2);
    let guard: (() => Promise<boolean>) | null = null;
    const view = render(
      <Harness
        hasUnsavedReview={() => false}
        flushLayerReview={flushLayerReview}
        onNavigationGuardChange={(nextGuard) => {
          guard = nextGuard;
        }}
        onNotify={vi.fn()}
      />,
    );

    expect(guard).not.toBeNull();
    await expect(guard!()).resolves.toBe(true);
    expect(flushLayerReview).not.toHaveBeenCalled();

    view.unmount();
    expect(guard).toBeNull();
  });

  it("blocks navigation and explains a failed required save", async () => {
    const onNotify = vi.fn();
    const failure = new Error("offline");
    let guard: (() => Promise<boolean>) | null = null;
    render(
      <Harness
        hasUnsavedReview={() => true}
        flushLayerReview={vi.fn(async () => {
          throw failure;
        })}
        onNavigationGuardChange={(nextGuard) => {
          guard = nextGuard;
        }}
        onNotify={onNotify}
      />,
    );

    await expect(guard!()).resolves.toBe(false);
    expect(onNotify).toHaveBeenCalledOnce();
    expect(onNotify.mock.calls[0]?.[0]).toContain("لحماية عملك");
  });

  it("asks before discarding a local editor draft", async () => {
    const confirmDiscardDraft = vi.fn(async () => false);
    let guard: (() => Promise<boolean>) | null = null;
    render(
      <Harness
        hasUnsavedReview={() => false}
        hasUnsavedDraft={() => true}
        confirmDiscardDraft={confirmDiscardDraft}
        flushLayerReview={vi.fn(async () => 1)}
        onNavigationGuardChange={(nextGuard) => {
          guard = nextGuard;
        }}
        onNotify={vi.fn()}
      />,
    );

    await expect(guard!()).resolves.toBe(false);
    expect(confirmDiscardDraft).toHaveBeenCalledOnce();
  });

  it("protects local drafts from browser unload", () => {
    render(
      <Harness
        hasUnsavedReview={() => false}
        hasUnsavedDraft={() => true}
        flushLayerReview={vi.fn(async () => 1)}
        onNavigationGuardChange={vi.fn()}
        onNotify={vi.fn()}
      />,
    );

    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
