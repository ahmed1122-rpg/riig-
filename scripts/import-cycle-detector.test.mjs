import assert from "node:assert/strict";
import test from "node:test";
import { findDirectedCycles } from "./import-cycle-detector.mjs";

test("finds one directed import cycle without duplicating rotations", () => {
  const graph = new Map([
    ["a.ts", new Set(["b.ts"])],
    ["b.ts", new Set(["c.ts"])],
    ["c.ts", new Set(["a.ts"])],
  ]);

  assert.deepEqual(findDirectedCycles(graph), [
    ["a.ts", "b.ts", "c.ts", "a.ts"],
  ]);
});

test("accepts a directed acyclic import graph", () => {
  const graph = new Map([
    ["api.ts", new Set(["domain.ts"])],
    ["domain.ts", new Set()],
  ]);

  assert.deepEqual(findDirectedCycles(graph), []);
});
