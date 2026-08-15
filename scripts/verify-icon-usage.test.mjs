import assert from "node:assert/strict";
import test from "node:test";

import { findUnusedIconNames } from "./verify-icon-usage.mjs";

test("reports icon definitions without a production literal consumer", () => {
  const iconModule = "const iconNodes = {\n  used: [],\n  dead: [],\n};\n";
  assert.deepEqual(findUnusedIconNames(iconModule, '<Icon name="used" />'), ["dead"]);
});
