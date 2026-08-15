import { useMemo, useState } from "react";
import { Dialog } from "../../shared/Dialog";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";

type PdfTextOperation = "split" | "merge";

interface PdfTextOperationDialogProps {
  operation: PdfTextOperation;
  layers: Layer[];
  onClose: () => void;
  onApply: (
    input:
      | { operation: "split"; offset: number }
      | { operation: "merge"; separator: "space" | "newline" },
  ) => Promise<void>;
}

export function PdfTextOperationDialog({
  operation,
  layers,
  onClose,
  onApply,
}: PdfTextOperationDialogProps) {
  const text = layers[0]?.fullText ?? "";
  const characters = useMemo(() => Array.from(text), [text]);
  const wordTargets = useMemo(() => pdfSplitWordTargets(text), [text]);
  const [offset, setOffset] = useState(() => suggestedOffset(characters));
  const [separator, setSeparator] = useState<"space" | "newline">("space");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const firstPart = characters.slice(0, offset).join("");
  const secondPart = characters.slice(offset).join("");
  const splitValid =
    offset > 0 &&
    offset < characters.length &&
    Boolean(firstPart.trim()) &&
    Boolean(secondPart.trim());

  const submit = async () => {
    if (operation === "split" && !splitValid) {
      setError("اختر موضعًا يُنتج جزأين نصيين غير فارغين.");
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await onApply(
        operation === "split"
          ? { operation, offset }
          : { operation, separator },
      );
      onClose();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "تعذر تنفيذ العملية النصية.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      title={operation === "split" ? "فصل وحدة نصية" : "دمج وحدات نصية"}
      description={
        operation === "split"
          ? "يقسم النص والهندسة وترتيب القراءة مع الاحتفاظ بنسخة قابلة للتراجع."
          : "يدمج النصوص المحددة داخل الصفحة والمجموعة نفسيهما دون حذف سجل المراجعات."
      }
      className="pdf-text-operation-dialog"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button button--ghost" onClick={onClose}>
            إلغاء
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={submitting || (operation === "split" && !splitValid)}
            onClick={() => void submit()}
          >
            <Icon name={operation === "split" ? "split" : "merge"} size={15} />
            {submitting
              ? "جارٍ الحفظ…"
              : operation === "split"
                ? "تقسيم وحفظ مراجعة"
                : "دمج وحفظ مراجعة"}
          </button>
        </>
      }
    >
      {operation === "split" ? (
        <div className="pdf-text-split-control">
          <fieldset className="pdf-word-picker">
            <legend>انقر على الكلمة التي يبدأ عندها الجزء الثاني</legend>
            <div dir={layers[0]?.direction ?? "rtl"}>
              {wordTargets.map((word) => (
                <button
                  type="button"
                  key={`${word.offset}-${word.text}`}
                  aria-pressed={offset === word.offset}
                  onClick={() => setOffset(word.offset)}
                >
                  {word.text}
                </button>
              ))}
            </div>
          </fieldset>
          <label>
            <span>موضع دقيق بعد الحرف (اختياري)</span>
            <input
              type="number"
              min={1}
              max={Math.max(1, characters.length - 1)}
              value={offset}
              onChange={(event) => setOffset(Number(event.target.value))}
            />
          </label>
          <input
            type="range"
            min={1}
            max={Math.max(1, characters.length - 1)}
            value={offset}
            aria-label="موضع فصل النص"
            onChange={(event) => setOffset(Number(event.target.value))}
          />
          <div className="pdf-text-preview-grid">
            <section>
              <strong>الجزء الأول</strong>
              <p dir={layers[0]?.direction ?? "rtl"}>{firstPart || "—"}</p>
            </section>
            <section>
              <strong>الجزء الثاني</strong>
              <p dir={layers[0]?.direction ?? "rtl"}>{secondPart || "—"}</p>
            </section>
          </div>
        </div>
      ) : (
        <div className="pdf-text-merge-control">
          <p>{layers.length} وحدات محددة بالترتيب الحالي للقراءة:</p>
          <ol>
            {layers.map((layer) => (
              <li key={layer.id}>{layer.fullText ?? layer.name}</li>
            ))}
          </ol>
          <label>
            <span>الفاصل بين الوحدات</span>
            <select
              value={separator}
              onChange={(event) =>
                setSeparator(event.target.value as "space" | "newline")
              }
            >
              <option value="space">مسافة</option>
              <option value="newline">سطر جديد</option>
            </select>
          </label>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}

export function pdfSplitWordTargets(text: string): Array<{ text: string; offset: number }> {
  const characters = Array.from(text);
  const words: Array<{ text: string; offset: number }> = [];
  let index = 0;
  while (index < characters.length) {
    while (index < characters.length && /\s/u.test(characters[index]!)) index += 1;
    const start = index;
    while (index < characters.length && !/\s/u.test(characters[index]!)) index += 1;
    if (start > 0 && start < characters.length) {
      words.push({ text: characters.slice(start, index).join(""), offset: start });
    }
  }
  return words;
}

function suggestedOffset(characters: string[]): number {
  if (characters.length < 2) return 1;
  const midpoint = Math.floor(characters.length / 2);
  for (let distance = 0; distance < characters.length; distance += 1) {
    for (const candidate of [midpoint + distance, midpoint - distance]) {
      if (
        candidate > 0 &&
        candidate < characters.length &&
        /\s/u.test(characters[candidate - 1] ?? "")
      ) {
        return candidate;
      }
    }
  }
  return Math.max(1, midpoint);
}
