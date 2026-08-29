/** @vitest-environment jsdom */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSingleFlightAction } from "./useSingleFlightAction";

describe("useSingleFlightAction", () => {
  it("blocks a duplicate action before the disabled state renders", async () => {
    let finish!: () => void;
    const action = vi.fn(
      () => new Promise<void>((resolve) => { finish = resolve; }),
    );
    const { result } = renderHook(() => useSingleFlightAction("تعذر التنفيذ"));

    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = result.current.run(action);
      duplicate = result.current.run(action);
    });
    expect(await duplicate).toBe(false);
    expect(action).toHaveBeenCalledOnce();

    await act(async () => finish());
    expect(await first).toBe(true);
  });

  it("normalizes a non-Error rejection for the user", async () => {
    const { result } = renderHook(() => useSingleFlightAction("تعذر التنفيذ"));
    await act(async () => {
      expect(await result.current.run(async () => Promise.reject("offline")))
        .toBe(false);
    });
    expect(result.current.error).toBe("تعذر التنفيذ");
  });
});
