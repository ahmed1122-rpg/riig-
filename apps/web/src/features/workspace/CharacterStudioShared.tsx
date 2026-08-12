import type { CharacterCanonicalView } from "@motionprep/contracts";

export type StudioStage =
  | "bible"
  | "references"
  | "turntable"
  | "compare"
  | "rig";

export const studioStages: Array<{ id: StudioStage; label: string }> = [
  { id: "bible", label: "هوية الشخصية" },
  { id: "references", label: "المراجع" },
  { id: "turntable", label: "Turntable" },
  { id: "compare", label: "المقارنة والإصلاح" },
  { id: "rig", label: "Rig وPSD" },
];

export const characterViewLabels: Record<CharacterCanonicalView, string> = {
  frontal: "أمامي",
  "left-quarter": "ربع أيسر",
  "left-profile": "جانبي أيسر",
  "right-quarter": "ربع أيمن",
  "right-profile": "جانبي أيمن",
};

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

export function angleToView(angle: number): CharacterCanonicalView {
  if (angle <= -68) return "left-profile";
  if (angle <= -23) return "left-quarter";
  if (angle < 23) return "frontal";
  if (angle < 68) return "right-quarter";
  return "right-profile";
}
