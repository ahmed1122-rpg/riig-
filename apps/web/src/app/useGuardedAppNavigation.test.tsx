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
  it("adopts a created project into the current URL without guarded navigation", () => {
    window.history.replaceState(null, "", "/?view=workspace&mode=image");
    const controls = { current: null } as MutableRefObject<Navigation | null>;
    render(<Harness controls={controls} />);
    const guard = vi.fn().mockResolvedValue(false);
    controls.current?.registerWorkspaceNavigationGuard(guard);

    act(() => {
      controls.current?.adoptWorkspaceProject({
        mode: "image",
        project: {
          id: "project-created",
          name: "مشروع جديد",
          currentSourceVersionId: "source-created",
          currentSourceVersionNumber: 1,
        },
      });
    });

    expect(guard).not.toHaveBeenCalled();
    expect(controls.current?.workspaceProject?.id).toBe("project-created");
    expect(window.location.search).toContain("projectId=project-created");
    expect(window.location.search).toContain("sourceVersionId=source-created");
    expect(resolveEntryIntent(window.location.search).workspace.project).toEqual({
      id: "project-created",
      name: "مشروع جديد",
      currentSourceVersionId: "source-created",
      currentSourceVersionNumber: 1,
    });
  });

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

    let firstNavigation!: Promise<boolean>;
    let secondNavigation!: Promise<boolean>;
    act(() => {
      firstNavigation = controls.current!.navigateView("projects");
      secondNavigation = controls.current!.navigateView("exports");
    });
    await act(async () => second.resolve(true));
    await expect(secondNavigation).resolves.toBe(true);
    expect(view.getByTestId("view").textContent).toBe("exports");
    expect(window.location.search).toContain("view=exports");

    await act(async () => first.resolve(true));
    await expect(firstNavigation).resolves.toBe(false);
    expect(view.getByTestId("view").textContent).toBe("exports");
    expect(window.location.search).toContain("view=exports");
  });

  it("reports a blocked guarded navigation without changing workspace state", async () => {
    window.history.replaceState(null, "", "/?view=workspace&mode=image");
    const controls = { current: null } as MutableRefObject<Navigation | null>;
    const view = render(<Harness controls={controls} />);
    controls.current?.registerWorkspaceNavigationGuard(async () => false);

    let changed = true;
    await act(async () => {
      changed = await controls.current!.navigateView(
        "workspace",
        { mode: "book", project: null },
        true,
      );
    });

    expect(changed).toBe(false);
    expect(controls.current?.projectMode).toBe("image");
    expect(view.getByTestId("view").textContent).toBe("workspace");
    expect(window.location.search).toContain("mode=image");
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
