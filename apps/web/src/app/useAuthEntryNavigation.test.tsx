/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEntryIntent } from "../features/marketing/entryState";
import { useAuthEntryNavigation } from "./useAuthEntryNavigation";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("authentication entry navigation", () => {
  it("opens direct verification links immediately", () => {
    window.history.replaceState(
      null,
      "",
      "/?verificationToken=verification-token",
    );
    const { result } = renderHook(() =>
      useAuthEntryNavigation(resolveEntryIntent(window.location.search)),
    );

    expect(result.current.authOpen).toBe(true);
  });

  it("opens, remounts, and closes a URL-driven gateway across history changes", () => {
    const { result } = renderHook(() =>
      useAuthEntryNavigation(resolveEntryIntent(window.location.search)),
    );
    expect(result.current.authOpen).toBe(false);

    act(() => {
      window.history.pushState(
        null,
        "",
        "/?verificationToken=first-token",
      );
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.authOpen).toBe(true);
    expect(result.current.authEntryRevision).toBe(1);

    act(() => {
      window.history.pushState(null, "", "/?token=reset-token");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.authOpen).toBe(true);
    expect(result.current.authEntryRevision).toBe(2);

    act(() => {
      window.history.pushState(null, "", "/?view=projects");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.authOpen).toBe(false);
  });

  it("does not close a gateway opened explicitly on unrelated history changes", () => {
    const { result } = renderHook(() =>
      useAuthEntryNavigation(resolveEntryIntent(window.location.search)),
    );
    act(() => result.current.openAuth());
    act(() => {
      window.history.pushState(null, "", "/?view=help");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(result.current.authOpen).toBe(true);
  });
});
