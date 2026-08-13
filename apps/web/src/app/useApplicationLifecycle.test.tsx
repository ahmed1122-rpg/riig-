/** @vitest-environment jsdom */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { useRef, type MutableRefObject } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getApplicationCapabilities,
  getSession,
  unavailableApplicationCapabilities,
} from "../lib/api";
import { useApplicationLifecycle } from "./useApplicationLifecycle";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>(
    "../lib/api",
  );
  return {
    ...actual,
    getApplicationCapabilities: vi.fn(),
    getSession: vi.fn(),
  };
});

type Lifecycle = ReturnType<typeof useApplicationLifecycle>;

function Harness({
  onNotify,
  controls,
}: {
  onNotify: (message: string) => void;
  controls: MutableRefObject<Lifecycle | null>;
}) {
  const lifecycle = useApplicationLifecycle(onNotify);
  const stableControls = useRef(controls);
  stableControls.current.current = lifecycle;
  return (
    <>
      <output data-testid="phase">{lifecycle.sessionPhase}</output>
      <output data-testid="capabilities-phase">
        {lifecycle.capabilitiesPhase}
      </output>
      <button
        type="button"
        onClick={() => void lifecycle.refreshCapabilities()}
      >
        retry capabilities
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("application lifecycle", () => {
  it("resolves an initial session failure and can refresh after authentication", async () => {
    const user = {
      id: "user-1",
      name: "Creator",
      email: "creator@example.test",
      role: "creator" as const,
      mfaEnabled: false,
    };
    vi.mocked(getSession)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(user);
    vi.mocked(getApplicationCapabilities).mockResolvedValue(
      unavailableApplicationCapabilities,
    );
    const onNotify = vi.fn();
    const controls = { current: null } as MutableRefObject<Lifecycle | null>;
    const view = render(<Harness onNotify={onNotify} controls={controls} />);

    await waitFor(() =>
      expect(view.getByTestId("phase").textContent).toBe("resolved"),
    );
    expect(onNotify).toHaveBeenCalledWith("تعذر التحقق من جلسة الخادم.");

    await act(async () => {
      await expect(
        controls.current?.refreshSessionAfterAuthentication(),
      ).resolves.toBe(true);
    });
    expect(controls.current?.sessionUser).toEqual(user);
    expect(onNotify).toHaveBeenCalledWith("تم فتح جلسة آمنة بنجاح");
  });

  it("keeps capabilities failure explicit and recovers on retry", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(getApplicationCapabilities)
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({
        ...unavailableApplicationCapabilities,
        limits: {
          maxUploadBytes: 30 * 1024 * 1024,
          maxImageUploadBytes: 30 * 1024 * 1024,
          maxPdfUploadBytes: 30 * 1024 * 1024,
          maxPdfPages: 250,
          maxPdfTextItems: 100_000,
          maxImageLayers: 15,
        },
      });
    const controls = { current: null } as MutableRefObject<Lifecycle | null>;
    const view = render(
      <Harness onNotify={vi.fn()} controls={controls} />,
    );

    await waitFor(() =>
      expect(view.getByTestId("capabilities-phase").textContent).toBe("error"),
    );
    expect(controls.current?.capabilities.limits.maxUploadBytes).toBe(0);

    view.getByRole("button", { name: "retry capabilities" }).click();
    await waitFor(() =>
      expect(view.getByTestId("capabilities-phase").textContent).toBe("ready"),
    );
    expect(controls.current?.capabilities.limits.maxUploadBytes).toBe(
      30 * 1024 * 1024,
    );
    expect(controls.current?.capabilities.limits.maxImageUploadBytes).toBe(
      30 * 1024 * 1024,
    );
  });
});
