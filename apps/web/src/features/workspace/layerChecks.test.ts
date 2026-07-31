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
});
