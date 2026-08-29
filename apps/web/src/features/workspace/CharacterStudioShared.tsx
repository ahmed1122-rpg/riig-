export type StudioStage =
  | "bible"
  | "references"
  | "rig";

export const studioStages: Array<{ id: StudioStage; label: string }> = [
  { id: "bible", label: "بيانات الشخصية" },
  { id: "references", label: "قفل المصدر" },
  { id: "rig", label: "الطبقات وPSD" },
];

export function studioStatusLabel(status?: string): string {
  if (!status) return "غير متاح";
  return ({
    draft: "مسودة",
    queued: "في قائمة الانتظار",
    processing: "قيد المعالجة",
    verifying: "قيد التحقق",
    "needs-review": "يحتاج مراجعة",
    approved: "معتمد",
    failed: "فشل",
    cancelled: "ملغى",
    exported: "مُصدّر",
    retired: "متقاعد",
  } as Record<string, string>)[status] ?? status;
}

export function RatioInput({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label>
      <span>{label}</span>
      <input
        type="number"
        min={0.05}
        max={0.8}
        step={0.01}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
