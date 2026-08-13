// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layer } from "../../types";
import { MobileLayerActions } from "./MobileLayerActions";

const layers: Layer[] = [
  layer("first", "+العنوان"),
  layer("second", "+المتن"),
];

afterEach(cleanup);

describe("MobileLayerActions", () => {
  it("commits a normalized unique rename and rejects a sibling duplicate", () => {
    const onLayersChange = vi.fn();
    const { rerender } = renderActions({ onLayersChange });
    const input = screen.getByRole("textbox", { name: "اسم الطبقة" });

    fireEvent.change(input, { target: { value: "عنوان رئيسي" } });
    fireEvent.blur(input);
    expect(onLayersChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "first", name: "+عنوان رئيسي" }),
      layers[1],
    ]);

    rerender(renderActionsElement({ onLayersChange }));
    fireEvent.change(screen.getByRole("textbox", { name: "اسم الطبقة" }), {
      target: { value: "+المتن" },
    });
    fireEvent.blur(screen.getByRole("textbox", { name: "اسم الطبقة" }));
    expect(screen.getByRole("alert").textContent).toContain("مستخدم");
  });

  it("updates visibility and sends a scoped move command", async () => {
    const onLayersChange = vi.fn();
    const onLayerCommand = vi.fn(async () => undefined);
    renderActions({ onLayersChange, onLayerCommand });

    fireEvent.click(screen.getByRole("button", { name: "إخفاء" }));
    expect(onLayersChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "first", visible: false }),
      layers[1],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "تحريك الطبقة لأسفل" }));
    await waitFor(() => expect(onLayerCommand).toHaveBeenCalledWith({
      kind: "move-layer",
      layerId: "first",
      targetLayerId: "second",
      position: "after",
    }));
  });

  it("keeps visibility and unlock available while blocking locked content edits", () => {
    const locked = { ...layers[0]!, locked: true };
    const lockedLayers = [locked, layers[1]!];
    const onLayersChange = vi.fn();
    const onLayerCommand = vi.fn(async () => undefined);
    renderActions({
      layer: locked,
      layers: lockedLayers,
      onLayersChange,
      onLayerCommand,
    });

    expect((screen.getByRole("textbox", { name: "اسم الطبقة" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("slider", { name: /الشفافية/u }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "تحريك الطبقة لأسفل" }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "إخفاء" }));
    expect(onLayersChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: "first", visible: false, locked: true }),
      layers[1],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "فتح القفل" }));
    expect(onLayersChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: "first", locked: false }),
      layers[1],
    ]);
    expect(onLayerCommand).not.toHaveBeenCalled();
  });
});

function renderActions(overrides: {
  layer?: Layer;
  layers?: readonly Layer[];
  onLayersChange?: (nextLayers: Layer[]) => void;
  onLayerCommand?: () => Promise<void>;
} = {}) {
  return render(renderActionsElement(overrides));
}

function renderActionsElement(overrides: {
  layer?: Layer;
  layers?: readonly Layer[];
  onLayersChange?: (nextLayers: Layer[]) => void;
  onLayerCommand?: () => Promise<void>;
} = {}) {
  return (
    <MobileLayerActions
      layer={overrides.layer ?? layers[0]!}
      layers={overrides.layers ?? layers}
      onLayersChange={overrides.onLayersChange ?? (() => undefined)}
      onLayerCommand={overrides.onLayerCommand ?? (async () => undefined)}
      onNotify={() => undefined}
    />
  );
}

function layer(id: string, name: string): Layer {
  return {
    id,
    parentId: "group",
    name,
    kind: "text",
    visible: true,
    locked: false,
    opacity: 100,
    color: "#3bb3a9",
    pageNumber: 1,
  };
}
