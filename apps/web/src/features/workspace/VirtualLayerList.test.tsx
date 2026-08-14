// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VirtualLayerList } from "./VirtualLayerList";

describe("VirtualLayerList", () => {
  it("keeps a 5,000-layer list bounded and brings the active row into the DOM", async () => {
    const items = Array.from({ length: 5_000 }, (_, index) => ({
      id: `layer-${index}`,
      name: `+layer_${index}`,
    }));
    const view = render(
      <VirtualLayerList
        items={items}
        itemKey={(item) => item.id}
        rowHeight={48}
        activeKey="layer-4500"
        ariaLabel="طبقات اختبارية"
        renderItem={(item) => (
          <button type="button" data-testid="virtual-row">{item.name}</button>
        )}
      />,
    );

    await waitFor(() => {
      expect(view.getByText("+layer_4500")).toBeTruthy();
    });
    expect(view.getAllByTestId("virtual-row").length).toBeLessThanOrEqual(24);
    expect(view.container.querySelectorAll("*").length).toBeLessThan(60);
  });
});
