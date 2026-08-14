import assert from "node:assert/strict";
import test from "node:test";
import {
  ocrSelectorOutputFile,
  ocrSelectorReportScope,
  parseOcrSelectorOptions,
} from "./ocr-selector-policy.mjs";

test("defaults selector tuning to development only", () => {
  const options = parseOcrSelectorOptions([]);
  assert.equal(options.evaluationSplit, "development");
  assert.equal(options.fullGrid, false);
  assert.deepEqual([...options.requestedSampleIds], []);
  assert.equal(ocrSelectorReportScope(options), "development-triggered");
  assert.equal(
    ocrSelectorOutputFile(options),
    "selector-evaluation-development.json",
  );
});

test("supports an isolated validation full-grid report", () => {
  const options = parseOcrSelectorOptions([
    "--split=validation",
    "--full-grid",
    "--sample=validation-page-1",
  ]);
  assert.equal(options.evaluationSplit, "validation");
  assert.equal(options.fullGrid, true);
  assert.deepEqual([...options.requestedSampleIds], ["validation-page-1"]);
  assert.equal(
    ocrSelectorReportScope(options),
    "targeted-validation-full-grid",
  );
  assert.equal(
    ocrSelectorOutputFile(options),
    "selector-evaluation-validation-targeted.json",
  );
});

test("refuses holdout access and ambiguous split arguments", () => {
  assert.throws(
    () => parseOcrSelectorOptions(["--split=holdout"]),
    /holdout remains sealed/u,
  );
  assert.throws(
    () =>
      parseOcrSelectorOptions([
        "--split=development",
        "--split=validation",
      ]),
    /at most one/u,
  );
});
