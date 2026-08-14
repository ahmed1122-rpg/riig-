import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import {
  arrangeLayersForReading,
  collectLayerReviewUpdates,
  moveEditableLayer,
  reindexLayerOrder,
  snapshotLayerReview,
} from "./layerReviewState";

const layer: Layer = {
  id: "source",
  name: "+source",
  kind: "body",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#3bb3a9",
};

describe("layer review persistence", () => {
  it("sends only changed editable state with normalized opacity", () => {
    const snapshot = snapshotLayerReview([layer]);
    expect(
      collectLayerReviewUpdates(
        [{ ...layer, name: "+مراجعة", opacity: 45 }],
        snapshot,
      ),
    ).toEqual([
      {
        id: "source",
        name: "+مراجعة",
        visible: true,
        locked: false,
        opacity: 0.45,
        zIndex: 0,
      },
    ]);
  });

  it("detects and serializes a persisted layer-order change", () => {
    const second: Layer = {
      ...layer,
      id: "detail",
      name: "+detail",
      zIndex: 1,
    };
    const source = { ...layer, zIndex: 2 };
    const snapshot = snapshotLayerReview([source, second]);

    expect(
      collectLayerReviewUpdates(
        [
          { ...second, zIndex: 2 },
          { ...source, zIndex: 1 },
        ],
        snapshot,
      ),
    ).toEqual([
      expect.objectContaining({ id: "detail", zIndex: 2 }),
      expect.objectContaining({ id: "source", zIndex: 1 }),
    ]);
  });

  it("serializes editable geometry and text metadata", () => {
    const initial: Layer = {
      ...layer,
      kind: "text",
      bounds: { x: 1, y: 2, width: 30, height: 10 },
      direction: "rtl",
      textAlign: "start",
      fontFamily: "Noto Sans Arabic",
      fontSize: 16,
      fullContent: "النص الأصلي",
    };
    const changed: Layer = {
      ...initial,
      bounds: { x: 4, y: 5, width: 40, height: 12 },
      direction: "ltr",
      textAlign: "justify",
      fontFamily: "Inter",
      fontSize: 18,
      fullContent: "النص المصحح",
    };

    expect(
      collectLayerReviewUpdates([changed], snapshotLayerReview([initial])),
    ).toEqual([
      expect.objectContaining({
        bounds: changed.bounds,
        direction: "ltr",
        textAlign: "justify",
        fontFamily: "Inter",
        fontSize: 18,
        fullText: "النص المصحح",
      }),
    ]);
  });

  it("does not send unchanged layers", () => {
    expect(
      collectLayerReviewUpdates([layer], snapshotLayerReview([layer])),
    ).toEqual([]);
  });

  it("never serializes structural group edits", () => {
    const group: Layer = {
      ...layer,
      id: "page-group",
      kind: "group",
      name: "+page_001",
      locked: true,
    };
    const snapshot = snapshotLayerReview([group]);

    expect(
      collectLayerReviewUpdates(
        [{ ...group, name: "+changed", visible: false }],
        snapshot,
      ),
    ).toEqual([]);
  });

  it("never serializes edits to any fixed layer kind", () => {
    const fixedText: Layer = { ...layer, kind: "text", fixed: true };
    expect(
      collectLayerReviewUpdates(
        [{ ...fixedText, name: "+changed", locked: true }],
        snapshotLayerReview([fixedText]),
      ),
    ).toEqual([]);
  });

  it("reindexes editable layers while preserving fixed page layers", () => {
    const page: Layer = {
      ...layer,
      id: "page",
      name: "+page_001_background",
      kind: "page",
      locked: true,
      zIndex: 0,
      pageNumber: 1,
    };
    const first: Layer = {
      ...layer,
      id: "first",
      pageNumber: 1,
      readingOrder: 8,
    };
    const second: Layer = {
      ...layer,
      id: "second",
      pageNumber: 1,
      readingOrder: 12,
    };

    const result = reindexLayerOrder([first, page, second]);

    expect(result[0]).toMatchObject({
      id: "first",
      zIndex: 2,
      readingOrder: 0,
    });
    expect(result[1]).toBe(page);
    expect(result[2]).toMatchObject({
      id: "second",
      zIndex: 1,
      readingOrder: 1,
    });
  });

  it("moves an editable layer and reindexes the result", () => {
    const second = { ...layer, id: "second", name: "+second" };
    const result = moveEditableLayer([layer, second], "source", 1);

    expect(result?.layers.map((item) => item.id)).toEqual([
      "second",
      "source",
    ]);
    expect(result?.layers.map((item) => item.zIndex)).toEqual([2, 1]);
    expect(result?.moved).toBe(layer);
  });

  it("does not move editable layers across fixed page backgrounds", () => {
    const page = {
      ...layer,
      id: "page",
      kind: "page" as const,
    };

    expect(moveEditableLayer([layer, page], "source", 1)).toBeNull();
    expect(moveEditableLayer([layer, page], "page", 0)).toBeNull();
  });

  it("keeps groups fixed and blocks cross-page or cross-parent moves", () => {
    const group: Layer = {
      ...layer,
      id: "group",
      name: "+page_001",
      kind: "group",
      parentId: null,
      pageNumber: 1,
    };
    const sibling = {
      ...layer,
      id: "sibling",
      parentId: "group",
      pageNumber: 1,
    };
    const otherParent = {
      ...layer,
      id: "other-parent",
      parentId: "nested",
      pageNumber: 1,
    };
    const otherPage = {
      ...layer,
      id: "other-page",
      parentId: "group-2",
      pageNumber: 2,
    };

    expect(moveEditableLayer([group, sibling], "group", 1)).toBeNull();
    expect(moveEditableLayer([sibling, otherParent], sibling.id, 1)).toBeNull();
    expect(moveEditableLayer([sibling, otherPage], sibling.id, 1)).toBeNull();
  });

  it("arranges pages top-to-bottom and respects RTL horizontal order", () => {
    const rtlRight: Layer = {
      ...layer,
      id: "rtl-right",
      pageNumber: 1,
      direction: "rtl",
      bounds: { x: 300, y: 20, width: 40, height: 20 },
    };
    const rtlLeft: Layer = {
      ...layer,
      id: "rtl-left",
      pageNumber: 1,
      direction: "rtl",
      bounds: { x: 100, y: 20, width: 40, height: 20 },
    };
    const laterPage: Layer = {
      ...layer,
      id: "later-page",
      pageNumber: 2,
      bounds: { x: 0, y: 0, width: 40, height: 20 },
    };

    const result = arrangeLayersForReading([
      laterPage,
      rtlLeft,
      rtlRight,
    ]);

    expect(result.map((item) => item.id)).toEqual([
      "rtl-right",
      "rtl-left",
      "later-page",
    ]);
    expect(result.map((item) => item.readingOrder)).toEqual([0, 1, 0]);
  });

  it("clamps persisted opacity and includes reading order when present", () => {
    const snapshot = snapshotLayerReview([]);
    expect(
      collectLayerReviewUpdates(
        [
          { ...layer, id: "high", opacity: 160, readingOrder: 2 },
          { ...layer, id: "low", opacity: -20 },
        ],
        snapshot,
      ),
    ).toEqual([
      expect.objectContaining({
        id: "high",
        opacity: 1,
        readingOrder: 2,
      }),
      expect.objectContaining({
        id: "low",
        opacity: 0,
      }),
    ]);
  });
});
