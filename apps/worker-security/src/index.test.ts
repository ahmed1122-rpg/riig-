import assert from "node:assert/strict";
import test from "node:test";
import { main } from "./index.js";

test("starts the fail-closed malware scan worker", async () => {
  let called = false;
  await main(async () => {
    called = true;
  });
  assert.equal(called, true);
});
