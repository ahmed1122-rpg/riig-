export type ExportGenerationState = "idle" | "working" | "done";

export interface ExportFormatState<TFormat extends string> {
  format: TFormat;
  generationState: ExportGenerationState;
}

export interface ExportScopeState<TScope extends string> {
  scope: TScope;
  generationState: ExportGenerationState;
}

export function selectExportFormat<TFormat extends string>(
  current: ExportFormatState<TFormat>,
  nextFormat: TFormat,
): ExportFormatState<TFormat> {
  if (current.format === nextFormat) return current;
  return {
    format: nextFormat,
    generationState: "idle",
  };
}

export function selectExportScope<TScope extends string>(
  current: ExportScopeState<TScope>,
  nextScope: TScope,
): ExportScopeState<TScope> {
  if (current.scope === nextScope) return current;
  return {
    scope: nextScope,
    generationState: "idle",
  };
}
