/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import { ExportReviewLayerList } from "./ExportReviewLayerList";

afterEach(cleanup);

function layer(id: string, name: string): Layer {
  return {
    id,
    name,
    kind: "raster",
    visible: true,
    locked: false,
    opacity: 100,
    color: "#2563eb",
  };
}

describe("ExportReviewLayerList direction", () => {
  it("delegates mixed layer names to the browser bidi algorithm", () => {
    render(
      <ExportReviewLayerList
        layers={[layer("latin", "+Head_01"), layer("arabic", "+الرأس_01")]}
        selectedLayerId="latin"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("+Head_01").getAttribute("dir")).toBe("auto");
    expect(screen.getByText("+الرأس_01").getAttribute("dir")).toBe("auto");
  });
});
