import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMaintainability,
  verifyMaintainability,
} from "./verify-maintainability.mjs";

const repeated = Array.from(
  { length: 18 },
  (_, index) => `const value${index} = source${index};`,
).join("\n");

test("detects exact clones and oversized production files", () => {
  const report = analyzeMaintainability(
    [
      ["apps/api/src/first.ts", repeated],
      ["apps/web/src/second.ts", repeated],
    ],
    { maxSourceLines: 10, warningSourceLines: 8, minCloneLines: 16 },
  );

  assert.deepEqual(report.oversizedFiles, {
    "apps/api/src/first.ts": 18,
    "apps/web/src/second.ts": 18,
  });
  assert.equal(report.exactCloneBlockCount, 1);
  assert.equal(report.exactClonedLines, 18);
});

test("ratchet permits shrinkage and rejects new debt", () => {
  const baseline = {
    maxSourceLines: 10,
    warningSourceLines: 8,
    minCloneLines: 16,
    oversizedFiles: { "apps/api/src/first.ts": 20 },
    maxExactCloneBlocks: 0,
    maxExactClonedLines: 0,
  };
  const smaller = analyzeMaintainability(
    [["apps/api/src/first.ts", "const value = true;\n".repeat(18)]],
    { maxSourceLines: 10, warningSourceLines: 8, minCloneLines: 16 },
  );
  assert.deepEqual(verifyMaintainability(smaller, baseline), []);

  const newDebt = analyzeMaintainability(
    [["apps/api/src/new.ts", "const value = true;\n".repeat(18)]],
    { maxSourceLines: 10, warningSourceLines: 8, minCloneLines: 16 },
  );
  assert.match(
    verifyMaintainability(newDebt, baseline).join("\n"),
    /new oversized production file/u,
  );
});

test("warns at 450 lines and fails only above the 550-line cap", () => {
  const source = (prefix, lines) =>
    Array.from(
      { length: lines },
      (_, index) => `const ${prefix}${index} = true;`,
    ).join("\n");
  const report = analyzeMaintainability(
    [
      ["apps/api/src/below-warning.ts", source("below", 449)],
      ["apps/api/src/at-warning.ts", source("warning", 450)],
      ["apps/api/src/at-cap.ts", source("cap", 550)],
      ["apps/api/src/above-cap.ts", source("above", 551)],
    ],
  );

  assert.deepEqual(report.warningFiles, {
    "apps/api/src/at-warning.ts": 450,
    "apps/api/src/at-cap.ts": 550,
  });
  assert.deepEqual(report.oversizedFiles, {
    "apps/api/src/above-cap.ts": 551,
  });
});
