/** @vitest-environment jsdom */

import { act, cleanup, render } from "@testing-library/react";
import {
  useEffect,
  useState,
  type MutableRefObject,
} from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LayerDocumentView } from "../../lib/api";
import { updateLayerDocument } from "../../lib/api";
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

function Harness({
  layer,
  controls,
}: {
  layer: Layer;
  controls: MutableRefObject<AutosaveControls | null>;
}) {
  const [revision, setRevision] = useState<number | undefined>(1);
  const [, setSaveState] = useState<WorkspaceSaveState>("idle");
  const autosave = useWorkspaceReviewAutosave({
    projectId: "project-1",
    sourceVersionId: "source-1",
    persistedSource: true,
    revision,
    layers: [layer],
    setRevision,
    setSaveState,
    onNotify: vi.fn(),
    onRevisionConflict: async () => undefined,
  });

  useEffect(() => {
    autosave.adoptSavedReview([baseline], 1);
  }, []);
  controls.current = autosave;
  return null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("workspace review autosave", () => {
  it("warns before unload while dirty and clears the warning after flush", async () => {
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

    const dirtyUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyUnload);
    expect(dirtyUnload.defaultPrevented).toBe(true);
    expect(controls.current?.hasUnsavedReview()).toBe(true);

    await act(async () => {
      await controls.current?.flushLayerReview();
    });
    expect(updateLayerDocument).toHaveBeenCalledOnce();
    expect(controls.current?.hasUnsavedReview()).toBe(false);

    const savedUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(savedUnload);
    expect(savedUnload.defaultPrevented).toBe(false);
  });
});
