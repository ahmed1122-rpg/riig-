import { describe, expect, it } from "vitest";
import { applyReadingOrder } from "./reading-order.js";

describe("applyReadingOrder", () => {
  const layers = [
    { id: "unrelated", page: 2, x: 0, readingOrder: 99 },
    { id: "right", page: 1, x: 20, readingOrder: 8 },
    { id: "left", page: 1, x: 10, readingOrder: 7 },
  ];

  it("applies a domain comparator and preserves unrelated object identity", () => {
    const result = applyReadingOrder(layers, {
      appliesTo: (layer) => layer.page === 1,
      compare: (left, right) => left.x - right.x,
      startAt: 1,
    });

    expect(result.map((layer) => layer.readingOrder)).toEqual([99, 2, 1]);
    expect(result[0]).toBe(layers[0]);
  });

  it("supports zero-based regional OCR ordering", () => {
    const result = applyReadingOrder(layers, {
      appliesTo: (layer) => layer.page === 1,
      compare: (left, right) => right.x - left.x,
      startAt: 0,
    });

    expect(result.map((layer) => layer.readingOrder)).toEqual([99, 0, 1]);
  });
});
