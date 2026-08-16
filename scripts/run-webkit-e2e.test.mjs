import assert from "node:assert/strict";
import test from "node:test";
import {
  countProjectTests,
  isolatedProjectCommands,
  runWithFreshProcessRetry,
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

test("retries a failed WebKit shard once in a fresh process", () => {
  const calls = [];
  const retries = [];
  const command = ["test", "--project=mobile-webkit", "--shard=1/1"];
  const statuses = [1, 0];

  const result = runWithFreshProcessRetry(
    command,
    (arguments_) => {
      calls.push(arguments_);
      return { status: statuses.shift() };
    },
    (arguments_, status) => retries.push({ arguments_, status }),
  );

  assert.equal(result.status, 0);
  assert.deepEqual(calls, [command, command]);
  assert.deepEqual(retries, [{ arguments_: command, status: 1 }]);
});

test("does not retry a successful WebKit shard or exceed one fresh process retry", () => {
  let successfulCalls = 0;
  const success = runWithFreshProcessRetry(["test"], () => {
    successfulCalls += 1;
    return { status: 0 };
  });
  assert.equal(success.status, 0);
  assert.equal(successfulCalls, 1);

  let failedCalls = 0;
  const failure = runWithFreshProcessRetry(["test"], () => {
    failedCalls += 1;
    return { status: 1 };
  });
  assert.equal(failure.status, 1);
  assert.equal(failedCalls, 2);
});
