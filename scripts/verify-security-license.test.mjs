import assert from "node:assert/strict";
import test from "node:test";
import { verifySecurityAndLicense } from "./verify-security-license.mjs";

test("accepts the repository security and license boundary", async () => {
  assert.deepEqual(await verifySecurityAndLicense(), []);
});
