/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import { PdfExtractedTextPage } from "./PdfExtractedTextPage";

afterEach(cleanup);

const layer: Layer = {
  id: "text-1",
  name: "+Body",
  kind: "text",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#111",
  fullText: "Hello مرحبا",
  bounds: { x: 10, y: 20, width: 100, height: 30 },
};

describe("PdfExtractedTextPage text direction", () => {
  it("uses browser-native first-strong direction for display and editing", () => {
    const props = {
      layers: [layer],
      pageNumber: 1,
      pageSize: { width: 600, height: 800 },
      selectedLayerId: layer.id,
      onTextEditChange: vi.fn(),
      onTextEditFinish: vi.fn(),
    };
    const view = render(<PdfExtractedTextPage {...props} />);
    expect(screen.getByText("Hello مرحبا").getAttribute("dir")).toBe("auto");

    view.rerender(
      <PdfExtractedTextPage
        {...props}
        textEdit={{ layerId: layer.id, draft: "مرحبا Hello" }}
      />,
    );
    expect(screen.getByRole("textbox").getAttribute("dir")).toBe("auto");
  });

  it("keeps explicit document direction authoritative", () => {
    render(
      <PdfExtractedTextPage
        layers={[{ ...layer, direction: "rtl" }]}
        pageNumber={1}
        pageSize={{ width: 600, height: 800 }}
        selectedLayerId={layer.id}
        onTextEditChange={vi.fn()}
        onTextEditFinish={vi.fn()}
      />,
    );

    expect(screen.getByText("Hello مرحبا").getAttribute("dir")).toBe("rtl");
  });
});
