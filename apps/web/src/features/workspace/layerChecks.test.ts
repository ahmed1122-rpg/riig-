import { describe, expect, it } from "vitest";
import type { Layer } from "../../types";
import { getLayerCheckSummary } from "./layerChecks";

const layer: Layer = {
  id: "layer-1",
  name: "+طبقة",
  kind: "body",
  visible: true,
  locked: false,
  opacity: 100,
  confidence: 96,
  color: "#3bb3a9",
};

describe("workspace layer checks", () => {
  it("returns the same computed summary for every check consumer", () => {
    expect(getLayerCheckSummary("image", [layer])).toMatchObject({
      issueCount: 0,
      title: "الفحص سليم",
      description: "لا توجد مشكلات مكتشفة",
    });
  });

  it("counts real naming, confidence, and layer-limit issues", () => {
    const layers = Array.from({ length: 16 }, (_, index) => ({
      ...layer,
      id: `layer-${index}`,
      name: index === 0 ? "++مكرر" : `+طبقة_${index}`,
      confidence: index === 1 ? 70 : 96,
    }));
    expect(getLayerCheckSummary("image", layers)).toMatchObject({
      issueCount: 3,
      title: "تحتاج مراجعة",
      description: "3 ملاحظات فعلية",
    });
  });

  it("reports graph diagnostics for missing parents and scoped duplicate names", () => {
    const summary = getLayerCheckSummary("image", [
      { ...layer, id: "first", name: "+مكرر", parentId: "missing" },
      { ...layer, id: "second", name: "+مكرر", parentId: "missing" },
    ]);

    expect(summary.issueCount).toBeGreaterThanOrEqual(3);
    expect(summary.diagnostics).toEqual(expect.arrayContaining([
      expect.stringContaining("اسم مكرر"),
      expect.stringContaining("مجلد أب مفقود"),
    ]));
  });
});
