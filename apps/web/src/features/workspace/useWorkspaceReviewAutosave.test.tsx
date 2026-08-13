/** @vitest-environment jsdom */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerDocumentView } from "../../lib/api";
import { updateLayerDocument } from "../../lib/api";
import { ApiError } from "../../lib/api/transport";
import type { Layer } from "../../types";
import type { WorkspaceSaveState } from "./WorkspaceChrome";
import { useWorkspaceReviewAutosave } from "./useWorkspaceReviewAutosave";

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>(
    "../../lib/api",
  );
  return { ...actual, updateLayerDocument: vi.fn() };
});

const baseline: Layer = {
  id: "layer-1",
  name: "+layer",
  kind: "body",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#000000",
};

interface AutosaveControls {
  flushLayerReview(): Promise<number>;
  hasUnsavedReview(): boolean;
}

const ignoreRevisionConflict = async () => undefined;

function Harness({
  layer,
  controls,
  onRevisionConflict = ignoreRevisionConflict,
}: {
  layer: Layer;
  controls: MutableRefObject<AutosaveControls | null>;
  onRevisionConflict?: (error: unknown) => Promise<void>;
}) {
  const [revision, setRevision] = useState<number | undefined>(1);
  const [saveState, setSaveState] =
    useState<WorkspaceSaveState>("unavailable");
  const layers = useMemo(() => [layer], [layer]);
  const onNotify = useMemo(() => vi.fn(), []);
  const autosave = useWorkspaceReviewAutosave({
    projectId: "project-1",
    sourceVersionId: "source-1",
    persistedSource: true,
    ...(revision === undefined ? {} : { revision }),
    layers,
    setRevision,
    setSaveState,
    onNotify,
    onRevisionConflict,
  });

  useEffect(() => {
    autosave.adoptSavedReview([baseline], 1);
  }, []);
  controls.current = autosave;
  return <output data-testid="save-state">{saveState}</output>;
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("workspace review autosave", () => {
  it("returns to saved when pending edits are reverted before autosave", async () => {
    const controls = { current: null } as MutableRefObject<AutosaveControls | null>;
    const view = render(<Harness layer={baseline} controls={controls} />);
    await waitFor(() =>
      expect(view.getByTestId("save-state").textContent).toBe("saved"),
    );

    view.rerender(
      <Harness
        layer={{ ...baseline, opacity: 35 }}
        controls={controls}
      />,
    );
    await waitFor(() =>
      expect(view.getByTestId("save-state").textContent).toBe("dirty"),
    );

    view.rerender(<Harness layer={baseline} controls={controls} />);
    await waitFor(() =>
      expect(view.getByTestId("save-state").textContent).toBe("saved"),
    );
    expect(updateLayerDocument).not.toHaveBeenCalled();
    expect(controls.current?.hasUnsavedReview()).toBe(false);
  });

  it("keeps failed changes dirty and saves them on an explicit retry", async () => {
    const networkFailure = new ApiError(
      "NETWORK_ERROR",
      "offline",
      0,
      undefined,
      true,
    );
    vi.mocked(updateLayerDocument)
      .mockRejectedValueOnce(networkFailure)
      .mockResolvedValueOnce({ revision: 2 } as LayerDocumentView);
    const controls = { current: null } as MutableRefObject<AutosaveControls | null>;
    const view = render(<Harness layer={baseline} controls={controls} />);
    view.rerender(
      <Harness
        layer={{ ...baseline, opacity: 60 }}
        controls={controls}
      />,
    );
    await waitFor(() =>
      expect(view.getByTestId("save-state").textContent).toBe("dirty"),
    );

    await act(async () => {
      await expect(controls.current?.flushLayerReview()).rejects.toThrow(
        "offline",
      );
    });
    expect(view.getByTestId("save-state").textContent).toBe("error");
    expect(controls.current?.hasUnsavedReview()).toBe(true);

    await act(async () => {
      await Promise.resolve();
      await controls.current?.flushLayerReview();
    });
    expect(updateLayerDocument).toHaveBeenCalledTimes(2);
    expect(vi.mocked(updateLayerDocument).mock.calls[0]?.[4]).toBe(
      vi.mocked(updateLayerDocument).mock.calls[1]?.[4],
    );
    expect(controls.current?.hasUnsavedReview()).toBe(false);
    expect(view.getByTestId("save-state").textContent).toBe("saved");
  });

  it("replays an ambiguous save before draining edits made after the failure", async () => {
    const networkFailure = new ApiError(
      "NETWORK_ERROR",
      "response lost",
      0,
      undefined,
      true,
    );
    vi.mocked(updateLayerDocument)
      .mockRejectedValueOnce(networkFailure)
      .mockResolvedValueOnce({ revision: 2 } as LayerDocumentView)
      .mockResolvedValueOnce({ revision: 3 } as LayerDocumentView);
    const controls = { current: null } as MutableRefObject<AutosaveControls | null>;
    const view = render(<Harness layer={baseline} controls={controls} />);
    view.rerender(
      <Harness layer={{ ...baseline, opacity: 60 }} controls={controls} />,
    );

    await act(async () => {
      await expect(controls.current?.flushLayerReview()).rejects.toBe(
        networkFailure,
      );
    });
    view.rerender(
      <Harness layer={{ ...baseline, opacity: 45 }} controls={controls} />,
    );

    await act(async () => {
      await controls.current?.flushLayerReview();
    });

    const calls = vi.mocked(updateLayerDocument).mock.calls;
    expect(calls).toHaveLength(3);
    expect(calls[0]?.[4]).toBe(calls[1]?.[4]);
    expect(calls[2]?.[4]).not.toBe(calls[1]?.[4]);
    expect(calls[0]?.[3][0]?.opacity).toBe(0.6);
    expect(calls[1]?.[3][0]?.opacity).toBe(0.6);
    expect(calls[2]?.[3][0]?.opacity).toBe(0.45);
    expect(view.getByTestId("save-state").textContent).toBe("saved");
  });

  it("keeps revision conflicts distinct from ordinary save failures", async () => {
    const conflict = new ApiError(
      "DOCUMENT_REVISION_CONFLICT",
      "A newer revision exists.",
      409,
      "request-conflict",
      false,
    );
    vi.mocked(updateLayerDocument).mockRejectedValue(conflict);
    const onRevisionConflict = vi.fn(async () => undefined);
    const controls = { current: null } as MutableRefObject<AutosaveControls | null>;
    const view = render(
      <Harness
        layer={baseline}
        controls={controls}
        onRevisionConflict={onRevisionConflict}
      />,
    );
    view.rerender(
      <Harness
        layer={{ ...baseline, opacity: 45 }}
        controls={controls}
        onRevisionConflict={onRevisionConflict}
      />,
    );

    await act(async () => {
      await expect(controls.current?.flushLayerReview()).rejects.toBe(conflict);
    });

    expect(view.getByTestId("save-state").textContent).toBe("conflict");
    expect(onRevisionConflict).toHaveBeenCalledWith(conflict);
    expect(controls.current?.hasUnsavedReview()).toBe(true);
  });

  it("exposes dirty state to the single navigation guard until flush", async () => {
    vi.mocked(updateLayerDocument).mockResolvedValue({
      revision: 2,
    } as LayerDocumentView);
    const controls = { current: null } as MutableRefObject<AutosaveControls | null>;
    const view = render(<Harness layer={baseline} controls={controls} />);
    view.rerender(
      <Harness
        layer={{ ...baseline, visible: false }}
        controls={controls}
      />,
    );

    expect(controls.current?.hasUnsavedReview()).toBe(true);

    await act(async () => {
      await controls.current?.flushLayerReview();
    });
    expect(updateLayerDocument).toHaveBeenCalledOnce();
    expect(controls.current?.hasUnsavedReview()).toBe(false);

  });
});
