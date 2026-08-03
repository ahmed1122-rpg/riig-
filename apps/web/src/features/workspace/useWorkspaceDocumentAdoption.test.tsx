/** @vitest-environment jsdom */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LayerDocumentView } from "../../lib/api";
import type { Layer } from "../../types";
import {
  loadRasterLayerPreviews,
  toWorkspaceLayers,
} from "./workspaceDocument";
import { useWorkspaceDocumentAdoption } from "./useWorkspaceDocumentAdoption";

vi.mock("./workspaceDocument", () => ({
  loadRasterLayerPreviews: vi.fn(),
  toWorkspaceLayers: vi.fn(),
}));

const document: LayerDocumentView = {
  schemaVersion: "1.0",
  projectId: "project-1",
  sourceVersionId: "source-1",
  revision: 7,
  generatedAt: "2026-08-02T00:00:00.000Z",
  width: 640,
  height: 480,
  colorSpace: "sRGB",
  layers: [],
  guidance: {
    revision: 4,
    mode: "guided",
    imageStrokes: [],
    pdfRegions: [],
    affectedBounds: null,
    appliedAt: "2026-08-02T00:00:00.000Z",
    warnings: [],
  },
};

const preparedLayers: Layer[] = [
  {
    id: "layer-1",
    name: "+first",
    kind: "body",
    visible: true,
    locked: false,
    opacity: 100,
    color: "#000000",
  },
  {
    id: "layer-2",
    name: "+second",
    kind: "body",
    visible: true,
    locked: false,
    opacity: 100,
    color: "#ffffff",
  },
];

beforeEach(() => {
  vi.mocked(loadRasterLayerPreviews).mockResolvedValue({
    previews: new Map([["layer-2", "blob:preview"]]),
    urls: ["blob:preview"],
  });
  vi.mocked(toWorkspaceLayers).mockReturnValue(preparedLayers);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useWorkspaceDocumentAdoption", () => {
  it("loads raster previews and atomically adopts the preferred layer", async () => {
    const replaceLayerAssetUrls = vi.fn();
    const applyPreparedDocument = vi.fn();
    const adoptSavedReview = vi.fn();
    const setGuidanceRevision = vi.fn();
    const setActiveLayerId = vi.fn();
    const setSelectedIds = vi.fn();
    const { result } = renderHook(() =>
      useWorkspaceDocumentAdoption({
        mode: "image",
        projectId: "project-1",
        activePdfPage: 3,
        activeLayerId: "missing-layer",
        replaceLayerAssetUrls,
        applyPreparedDocument,
        adoptSavedReview,
        setGuidanceRevision,
        setActiveLayerId,
        setSelectedIds,
      }),
    );

    await act(async () => {
      await result.current(document, "layer-2");
    });

    expect(loadRasterLayerPreviews).toHaveBeenCalledWith(
      "project-1",
      "source-1",
      document,
    );
    expect(replaceLayerAssetUrls).toHaveBeenCalledWith(["blob:preview"]);
    expect(toWorkspaceLayers).toHaveBeenCalledWith(
      document,
      "image",
      new Map([["layer-2", "blob:preview"]]),
    );
    expect(applyPreparedDocument).toHaveBeenCalledWith(
      document,
      preparedLayers,
      3,
    );
    expect(adoptSavedReview).toHaveBeenCalledWith(preparedLayers, 7);
    expect(setGuidanceRevision).toHaveBeenCalledWith(4);
    expect(setActiveLayerId).toHaveBeenCalledWith("layer-2");
    expect(setSelectedIds).toHaveBeenCalledWith(["layer-2"]);
  });
});
