const allowedEvaluationSplits = new Set(["development", "validation"]);

export function parseOcrSelectorOptions(arguments_) {
  const requestedSplits = arguments_
    .filter((argument) => argument.startsWith("--split="))
    .map((argument) => argument.slice("--split=".length));
  if (requestedSplits.length > 1) {
    throw new Error("Specify at most one OCR selector evaluation split.");
  }
  const evaluationSplit = requestedSplits[0] || "development";
  if (!allowedEvaluationSplits.has(evaluationSplit)) {
    throw new Error(
      "OCR selector evaluation is restricted to development or validation; the holdout remains sealed.",
    );
  }
  const requestedSampleIds = new Set(
    arguments_
      .filter((argument) => argument.startsWith("--sample="))
      .map((argument) => argument.slice("--sample=".length))
      .filter(Boolean),
  );
  return {
    evaluationSplit,
    fullGrid: arguments_.includes("--full-grid"),
    requestedSampleIds,
  };
}

export function ocrSelectorReportScope(options) {
  const target = options.requestedSampleIds.size === 0
    ? options.evaluationSplit
    : `targeted-${options.evaluationSplit}`;
  return `${target}-${options.fullGrid ? "full-grid" : "triggered"}`;
}

export function ocrSelectorOutputFile(options) {
  const target = options.requestedSampleIds.size === 0
    ? options.evaluationSplit
    : `${options.evaluationSplit}-targeted`;
  return `selector-evaluation-${target}.json`;
}
