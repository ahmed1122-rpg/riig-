import assert from "node:assert/strict";
import test from "node:test";
import {
  countProjectTests,
  isolatedProjectCommands,
} from "./run-webkit-e2e.mjs";

test("counts only the requested project across nested Playwright suites", () => {
  const report = {
    suites: [{
      specs: [
        { tests: [{ projectName: "mobile-webkit" }] },
        { tests: [{ projectName: "desktop-webkit" }] },
      ],
      suites: [{ specs: [{ tests: [{ projectName: "mobile-webkit" }] }] }],
    }],
  };

  assert.equal(countProjectTests(report, "mobile-webkit"), 2);
  assert.equal(countProjectTests(report, "desktop-webkit"), 1);
});

test("creates one fully isolated shard command per discovered test", () => {
  assert.deepEqual(
    isolatedProjectCommands("mobile-webkit", 2, ["--grep", "PDF"]),
    [
      [
        "test",
        "--project=mobile-webkit",
        "--fully-parallel",
        "--shard=1/2",
        "--grep",
        "PDF",
      ],
      [
        "test",
        "--project=mobile-webkit",
        "--fully-parallel",
        "--shard=2/2",
        "--grep",
        "PDF",
      ],
    ],
  );
});
