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
  { id: "turntable", label: "منصة التدوير" },
  { id: "compare", label: "المقارنة والإصلاح" },
  { id: "rig", label: "الهيكل وPSD" },
];

export const characterPartLabels: Record<string, string> = {
  head: "الرأس",
  "left-eye": "العين اليسرى",
  "right-eye": "العين اليمنى",
  "left-brow": "الحاجب الأيسر",
  "right-brow": "الحاجب الأيمن",
  nose: "الأنف",
  mouth: "الفم",
  torso: "الجذع",
  "left-arm": "الذراع اليسرى",
  "right-arm": "الذراع اليمنى",
  "left-hand": "اليد اليسرى",
  "right-hand": "اليد اليمنى",
  "left-leg": "الساق اليسرى",
  "right-leg": "الساق اليمنى",
};

export function studioStatusLabel(status?: string): string {
  if (!status) return "غير متاح";
  return ({
    draft: "مسودة",
    training: "قيد التدريب",
    ready: "جاهز",
    queued: "في قائمة الانتظار",
    processing: "قيد المعالجة",
    verifying: "قيد التحقق",
    "needs-review": "يحتاج مراجعة",
    approved: "معتمد",
    rejected: "مرفوض",
    failed: "فشل",
    cancelled: "ملغى",
    exported: "مُصدّر",
    retired: "متقاعد",
  } as Record<string, string>)[status] ?? status;
}

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
