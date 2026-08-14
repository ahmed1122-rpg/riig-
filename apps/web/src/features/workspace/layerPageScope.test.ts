import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import {
  createPdfPageFolders,
  layersForWorkspacePage,
  workspaceLayerCounts,
} from "./layerPageScope";

const layer = (id: string, pageNumber?: number): Layer => ({
  id,
  name: `+${id}`,
  kind: "text",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#fff",
  ...(pageNumber === undefined ? {} : { pageNumber }),
});

describe("layersForWorkspacePage", () => {
  it("keeps image layers unscoped", () => {
    expect(layersForWorkspacePage("image", [layer("a", 1), layer("b", 2)], 1))
      .toHaveLength(2);
  });

  it("returns only the active PDF page and treats legacy layers as page one", () => {
    expect(
      layersForWorkspacePage(
        "book",
        [layer("legacy"), layer("one", 1), layer("two", 2)],
        1,
      ).map((item) => item.id),
    ).toEqual(["legacy", "one"]);
  });

  it("excludes structural groups from active and total counts", () => {
    const group: Layer = {
      ...layer("page-root", 1),
      name: "+page_001",
      kind: "group",
      parentId: null,
    };
    expect(
      workspaceLayerCounts(
        "book",
        [group, { ...layer("background", 1), kind: "page", parentId: group.id }, layer("two", 2)],
        1,
        [{ pageNumber: 1 }, { pageNumber: 2 }, { pageNumber: 3 }],
      ),
    ).toEqual({
      currentPageLayerCount: 1,
      totalLayerCount: 2,
      pageCount: 3,
    });
  });

  it("builds persisted and virtual page folders, including empty declared pages", () => {
    const pageRoot: Layer = {
      ...layer("page-root", 1),
      name: "+page_001",
      kind: "group",
      parentId: null,
    };
    const topic: Layer = {
      ...layer("topic", 1),
      kind: "group",
      parentId: pageRoot.id,
    };
    const folders = createPdfPageFolders(
      [
        pageRoot,
        topic,
        { ...layer("heading", 1), parentId: topic.id },
        layer("legacy-two", 2),
      ],
      [{ pageNumber: 1 }, { pageNumber: 2 }, { pageNumber: 3 }],
    );
    expect(folders.map(({ pageNumber, virtual }) => [pageNumber, virtual])).toEqual([
      [1, false],
      [2, true],
      [3, true],
    ]);
    expect(folders[0]?.nodes[0]).toMatchObject({
      layer: { id: "topic" },
      children: [{ layer: { id: "heading" } }],
    });
    expect(folders[2]?.contentLayers).toEqual([]);
  });

  it("indexes the maximum 100k-layer PDF fixture in one page-grouping pass", () => {
    const pageCount = 250;
    const perPage = 400;
    const layers = Array.from({ length: pageCount * perPage }, (_, index) =>
      layer(`layer-${index}`, Math.floor(index / perPage) + 1),
    );
    const folders = createPdfPageFolders(
      layers,
      Array.from({ length: pageCount }, (_, index) => ({ pageNumber: index + 1 })),
    );

    expect(folders).toHaveLength(pageCount);
    expect(folders.reduce((count, folder) => count + folder.contentLayers.length, 0))
      .toBe(100_000);
    expect(folders[249]?.contentLayers[399]?.id).toBe("layer-99999");
  });
});
