import type { Dispatch, SetStateAction } from "react";
import type { MarkerLabel, PdfRegion } from "./PdfMarkerOverlay";
import { createPdfRegionFromPercent } from "./pdfRegionGeometry";

export interface PdfKeyboardRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function PdfRegionCoordinateForm({
  keyboardRegion,
  setKeyboardRegion,
  error,
  setError,
  activeLabel,
  onAdd,
}: {
  keyboardRegion: PdfKeyboardRegion;
  setKeyboardRegion: Dispatch<SetStateAction<PdfKeyboardRegion>>;
  error: string;
  setError: Dispatch<SetStateAction<string>>;
  activeLabel: MarkerLabel;
  onAdd: (region: Omit<PdfRegion, "id" | "order">) => boolean;
}) {
  const errorId = "pdf-coordinate-error";
  return (
    <form
      className="guidance-coordinate-entry guidance-coordinate-entry--region"
      aria-label="إضافة منطقة PDF بالإحداثيات"
      onSubmit={(event) => {
        event.preventDefault();
        const result = createPdfRegionFromPercent(keyboardRegion, activeLabel);
        if (!result.valid) {
          setError(result.message);
          return;
        }
        if (onAdd(result.region)) setError("");
      }}
    >
      {([
        ["x", "الموضع الأفقي %"],
        ["y", "الموضع الرأسي %"],
        ["width", "العرض %"],
        ["height", "الارتفاع %"],
      ] as const).map(([field, label]) => (
        <label key={field}>
          {label}
          <input
            type="number"
            min={field === "width" || field === "height" ? 1 : 0}
            max={field === "x" || field === "y" ? 99 : 100}
            value={keyboardRegion[field]}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              setKeyboardRegion((current) => ({
                ...current,
                [field]: Number(event.target.value),
              }));
              setError("");
            }}
          />
        </label>
      ))}
      <button type="submit">إضافة منطقة</button>
      {error && (
        <small id={errorId} className="field-error" role="alert">
          {error}
        </small>
      )}
    </form>
  );
}
