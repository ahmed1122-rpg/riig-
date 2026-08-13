/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCharacterRigStudio,
  type CharacterRigStudioState,
} from "../../lib/api/character-rig-client";
import { useCharacterStudioPolling } from "./useCharacterStudioPolling";

vi.mock("../../lib/api/character-rig-client", () => ({
  getCharacterRigStudio: vi.fn(),
}));

const emptyStudio: CharacterRigStudioState = {
  bible: null,
  references: [],
  identityModel: null,
  generations: [],
  rig: null,
  jobs: [],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useCharacterStudioPolling", () => {
  it("loads once while idle and starts bounded polling when work becomes active", async () => {
    vi.useFakeTimers();
    vi.mocked(getCharacterRigStudio).mockResolvedValue(emptyStudio);
    const onState = vi.fn();
    const onInitialError = vi.fn();
    const onLoadingChange = vi.fn();
    const { rerender } = renderHook(
      ({ active }) => useCharacterStudioPolling({
        projectId: "project-1",
        active,
        onState,
        onInitialError,
        onLoadingChange,
      }),
      { initialProps: { active: false } },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getCharacterRigStudio).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(3_000));
    expect(getCharacterRigStudio).toHaveBeenCalledOnce();

    rerender({ active: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getCharacterRigStudio).toHaveBeenCalledTimes(2);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(getCharacterRigStudio).toHaveBeenCalledTimes(3);
    expect(onState).toHaveBeenCalledWith(emptyStudio);
    expect(onInitialError).not.toHaveBeenCalled();
    expect(onLoadingChange).toHaveBeenCalledWith(false);
  });

  it("reports an initial failure once while the scheduler retries it", async () => {
    vi.useFakeTimers();
    vi.mocked(getCharacterRigStudio).mockRejectedValue(new Error("offline"));
    const onInitialError = vi.fn();
    renderHook(() => useCharacterStudioPolling({
      projectId: "project-1",
      active: true,
      onState: vi.fn(),
      onInitialError,
      onLoadingChange: vi.fn(),
    }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onInitialError).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(3_500));
    expect(vi.mocked(getCharacterRigStudio).mock.calls.length).toBeGreaterThan(1);
    expect(onInitialError).toHaveBeenCalledOnce();
  });
});
