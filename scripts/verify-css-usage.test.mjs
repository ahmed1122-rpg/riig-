import assert from "node:assert/strict";
import test from "node:test";

import { findUnusedCssClasses } from "./verify-css-usage.mjs";

test("reports selectors without production references", () => {
  assert.deepEqual(
    findUnusedCssClasses({
      styles: ".used, .dead, .is-ready { color: red; }",
      sources: '<div className="used" />',
      allowedDynamicClasses: new Set(["is-ready"]),
    }),
    ["dead"],
  );
});
