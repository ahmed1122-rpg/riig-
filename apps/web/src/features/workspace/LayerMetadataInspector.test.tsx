/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import { LayerMetadataInspector } from "./LayerMetadataInspector";

const textLayer: Layer = {
  id: "text-1",
  parentId: "page-1",
  name: "+عنوان",
  kind: "text",
  visible: true,
  locked: false,
  opacity: 100,
  color: "#6887d8",
  pageNumber: 1,
  readingOrder: 0,
  bounds: { x: 10, y: 20, width: 300, height: 40 },
  direction: "rtl",
  textAlign: "start",
  fontFamily: "Noto Sans Arabic",
  fontSize: 18,
  fullText: "النص الأصلي",
};

afterEach(cleanup);

describe("LayerMetadataInspector", () => {
  it("applies validated geometry, direction, and font mapping", () => {
    const onLayersChange = vi.fn();
    render(
      <LayerMetadataInspector
        layer={textLayer}
        layers={[textLayer]}
        onLayersChange={onLayersChange}
        onNotify={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("خصائص الطبقة"));
    fireEvent.change(screen.getByLabelText("X"), { target: { value: "25" } });
    fireEvent.change(screen.getByLabelText("الاتجاه"), { target: { value: "ltr" } });
    fireEvent.change(screen.getByLabelText("المحاذاة"), { target: { value: "center" } });
    fireEvent.change(screen.getByLabelText("مطابقة الخط"), { target: { value: "Inter" } });
    fireEvent.change(screen.getByLabelText("حجم الخط"), { target: { value: "22" } });
    fireEvent.change(screen.getByLabelText("محتوى النص"), { target: { value: "نص مصحح" } });
    fireEvent.click(screen.getByRole("button", { name: /تطبيق الخصائص/u }));

    expect(onLayersChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "text-1",
        bounds: { x: 25, y: 20, width: 300, height: 40 },
        direction: "ltr",
        textAlign: "center",
        fontFamily: "Inter",
        fontSize: 22,
        fullText: "نص مصحح",
      }),
    ]);
  });

  it("rejects invalid bounds without mutating layers", () => {
    const onLayersChange = vi.fn();
    render(
      <LayerMetadataInspector
        layer={textLayer}
        layers={[textLayer]}
        onLayersChange={onLayersChange}
        onNotify={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("خصائص الطبقة"));
    fireEvent.change(screen.getByLabelText("العرض"), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /تطبيق الخصائص/u }));

    expect(screen.getByRole("alert").textContent).toContain("أكبر من صفر");
    expect(onLayersChange).not.toHaveBeenCalled();
  });

  it("does not expose edits for structural page folders", () => {
    const { container } = render(
      <LayerMetadataInspector
        layer={{ ...textLayer, kind: "group", fixed: true }}
        layers={[]}
        onLayersChange={vi.fn()}
        onNotify={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("keeps content and metadata read-only while the layer is locked", () => {
    const onLayersChange = vi.fn();
    render(
      <LayerMetadataInspector
        layer={{ ...textLayer, locked: true }}
        layers={[{ ...textLayer, locked: true }]}
        onLayersChange={onLayersChange}
        onNotify={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("خصائص الطبقة"));
    expect(
      screen.getByRole("textbox", { name: "محتوى النص" }).matches(":disabled"),
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: /تطبيق الخصائص/u,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(onLayersChange).not.toHaveBeenCalled();
  });

  it("shows the complete parent breadcrumb without looping on malformed ancestry", () => {
    const page = {
      ...textLayer,
      id: "page-1",
      parentId: null,
      name: "+page_001",
      kind: "group" as const,
      fixed: true,
      locked: true,
    };
    const group = {
      ...textLayer,
      id: "heading-1",
      parentId: page.id,
      name: "+heading_001",
      kind: "group" as const,
    };
    const nested = { ...textLayer, parentId: group.id };
    render(
      <LayerMetadataInspector
        layer={nested}
        layers={[page, group, nested]}
        onLayersChange={vi.fn()}
        onNotify={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText("خصائص الطبقة"));
    expect(screen.getByLabelText("مسار الطبقة").textContent)
      .toContain("+page_001 / +heading_001 / +عنوان");
  });
});
