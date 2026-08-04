/** @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import { type MutableRefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEntryIntent } from "../features/marketing/entryState";
import { useGuardedAppNavigation } from "./useGuardedAppNavigation";

type Navigation = ReturnType<typeof useGuardedAppNavigation>;

function Harness({ controls }: { controls: MutableRefObject<Navigation | null> }) {
  const navigation = useGuardedAppNavigation(
    resolveEntryIntent(window.location.search),
  );
  controls.current = navigation;
  return <output data-testid="view">{navigation.view}</output>;
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("guarded application navigation", () => {
  it("lets only the latest guarded navigation commit", async () => {
    window.history.replaceState(
      null,
      "",
      "/?view=workspace&mode=image&projectId=project-1",
    );
    const controls = { current: null } as MutableRefObject<Navigation | null>;
    const view = render(<Harness controls={controls} />);
    const first = deferred<boolean>();
    const second = deferred<boolean>();
    controls.current?.registerWorkspaceNavigationGuard(
      vi.fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    );

    act(() => {
      controls.current?.navigateView("projects");
      controls.current?.navigateView("exports");
    });
    await act(async () => second.resolve(true));
    expect(view.getByTestId("view").textContent).toBe("exports");
    expect(window.location.search).toContain("view=exports");

    await act(async () => first.resolve(true));
    expect(view.getByTestId("view").textContent).toBe("exports");
    expect(window.location.search).toContain("view=exports");
  });

  it("restores the committed URL when back navigation is blocked", async () => {
    window.history.replaceState(null, "", "/?view=workspace&mode=book");
    const controls = { current: null } as MutableRefObject<Navigation | null>;
    const view = render(<Harness controls={controls} />);
    controls.current?.registerWorkspaceNavigationGuard(async () => false);

    window.history.pushState(null, "", "/?view=projects");
    await act(async () => {
      window.dispatchEvent(new PopStateEvent("popstate"));
      await Promise.resolve();
    });

    expect(view.getByTestId("view").textContent).toBe("workspace");
    expect(window.location.search).toContain("view=workspace");
  });
});
