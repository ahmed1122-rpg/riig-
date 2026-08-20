// @vitest-environment jsdom
import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import { WorkspaceMobileSheet } from "./WorkspaceMobileSheet";

const layers: Layer[] = [
  imageLayer("first", "+first"),
  imageLayer("second", "+second"),
];

describe("WorkspaceMobileSheet layer selection", () => {
  it("supports scoped multi-selection and atomic bulk actions", () => {
    const onLayerCommand = vi.fn().mockResolvedValue(undefined);
    function Harness() {
      const [selectedIds, setSelectedIds] = useState(["first"]);
      const [activeId, setActiveId] = useState("first");
      return (
        <WorkspaceMobileSheet
          activePanel="layers"
          mode="image"
          persistedSource
          tools={[]}
          activeTool="image.keep"
          layers={layers}
          selectedIds={selectedIds}
          activeLayerId={activeId}
          activePdfPage={1}
          pdfPages={[]}
          layerCheckSummary={{
            issueCount: 0,
            title: "سليم",
            description: "لا توجد مشكلات",
            items: [],
            diagnostics: [],
          }}
          onClose={() => undefined}
          onUseTool={() => undefined}
          onSelectLayer={(id, next = [id]) => {
            setActiveId(id);
            setSelectedIds(next);
          }}
          onPdfPageChange={async () => true}
          onLayersChange={() => undefined}
          onLayerCommand={onLayerCommand}
          onNotify={() => undefined}
        />
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: /تحديد متعدد/u }));
    fireEvent.click(screen.getByRole("button", { name: /\+second/u }));
    const toolbar = screen.getByRole("toolbar", { name: "إجراءات الطبقات المحددة" });
    expect(toolbar).toBeTruthy();

    fireEvent.click(within(toolbar).getByRole("button", { name: "إخفاء" }));
    expect(onLayerCommand).toHaveBeenCalledWith({
      kind: "update-state",
      scope: { kind: "layers", layerIds: ["first", "second"] },
      visible: false,
    });
  });
});

function imageLayer(id: string, name: `+${string}`): Layer {
  return {
    id,
    parentId: null,
    name,
    kind: "raster",
    presentationKind: "body",
    visible: true,
    locked: false,
    opacity: 100,
    color: "#3bb3a9",
  };
}
