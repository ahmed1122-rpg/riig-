/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useWorkspacePreference } from "./useWorkspacePreference";

beforeEach(() => window.localStorage.clear());

describe("useWorkspacePreference", () => {
  it("recovers from malformed and type-invalid storage", () => {
    window.localStorage.setItem("broken-json", "{");
    window.localStorage.setItem("wrong-type", JSON.stringify("wide"));

    const malformed = renderHook(() =>
      useWorkspacePreference("broken-json", 326),
    );
    const wrongType = renderHook(() =>
      useWorkspacePreference("wrong-type", 326),
    );

    expect(malformed.result.current[0]).toBe(326);
    expect(wrongType.result.current[0]).toBe(326);
  });

  it("uses a semantic validator so stale enum values cannot empty the UI", () => {
    window.localStorage.setItem("filter", JSON.stringify("removed-filter"));
    const { result } = renderHook(() =>
      useWorkspacePreference(
        "filter",
        "all" as "all" | "visible",
        (value): value is "all" | "visible" =>
          value === "all" || value === "visible",
      ),
    );

    expect(result.current[0]).toBe("all");
    expect(window.localStorage.getItem("filter")).toBe(JSON.stringify("all"));
  });

  it("persists a validated update", () => {
    const { result } = renderHook(() =>
      useWorkspacePreference("density", "dense"),
    );
    act(() => result.current[1]("comfortable"));

    expect(result.current[0]).toBe("comfortable");
    expect(window.localStorage.getItem("density"))
      .toBe(JSON.stringify("comfortable"));
  });
});
