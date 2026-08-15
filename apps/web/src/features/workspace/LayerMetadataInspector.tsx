import { useEffect, useId, useState } from "react";
import { MAX_LAYER_TEXT_CHARACTERS } from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";
import { isPageLayer } from "./workspaceLayerKinds";

interface LayerMetadataInspectorProps {
  layer: Layer;
  layers: readonly Layer[];
  compact?: boolean;
  onLayersChange: (layers: Layer[]) => void;
  onNotify: (message: string) => void;
}

interface MetadataDraft {
  x: string;
  y: string;
  width: string;
  height: string;
  direction: "ltr" | "rtl";
  textAlign: NonNullable<Layer["textAlign"]>;
  fontFamily: string;
  fontSize: string;
  fullText: string;
}

export function LayerMetadataInspector({
  layer,
  layers,
  compact = false,
  onLayersChange,
  onNotify,
}: LayerMetadataInspectorProps) {
  const textCounterId = useId();
  const [draft, setDraft] = useState(() => createDraft(layer));
  const [error, setError] = useState("");
  const breadcrumb = createLayerBreadcrumb(layer, layers);
  const structural =
    isPageLayer(layer) || layer.kind === "group" || Boolean(layer.fixed);

  useEffect(() => {
    setDraft(createDraft(layer));
    setError("");
  }, [layer]);

  if (structural) return null;

  const updateDraft = (changes: Partial<MetadataDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    setError("");
  };
  const apply = () => {
    if (layer.locked) {
      setError("افتح قفل الطبقة قبل تعديل خصائصها أو محتواها.");
      return;
    }
    const bounds = layer.bounds
      ? {
          x: Number(draft.x),
          y: Number(draft.y),
          width: Number(draft.width),
          height: Number(draft.height),
        }
      : undefined;
    if (
      bounds &&
      (!Object.values(bounds).every(Number.isFinite) ||
        bounds.x < 0 ||
        bounds.y < 0 ||
        bounds.width <= 0 ||
        bounds.height <= 0)
    ) {
      setError("الإحداثيات يجب أن تكون أرقامًا موجبة، والعرض والارتفاع أكبر من صفر.");
      return;
    }
    const fontFamily = draft.fontFamily.trim();
    const fontSize = Number(draft.fontSize);
    const fullText = draft.fullText.trim();
    if (
      layer.kind === "text" &&
      (fontFamily.length === 0 ||
        fontFamily.length > 120 ||
        !Number.isFinite(fontSize) ||
        fontSize < 1 ||
        fontSize > 500 ||
        fullText.length === 0 ||
        Array.from(fullText).length > MAX_LAYER_TEXT_CHARACTERS ||
        /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(fullText))
    ) {
      setError(
        `أدخل نصًا صالحًا حتى ${MAX_LAYER_TEXT_CHARACTERS.toLocaleString("ar")} حرف، واسم خط صالحًا وحجمًا بين 1 و500.`,
      );
      return;
    }
    onLayersChange(
      layers.map((candidate) =>
        candidate.id === layer.id
          ? {
              ...candidate,
              ...(bounds ? { bounds } : {}),
              ...(layer.kind === "text"
                ? {
                    direction: draft.direction,
                    textAlign: draft.textAlign,
                    fontFamily,
                    fontSize,
                    fullText,
                  }
                : {}),
            }
          : candidate,
      ),
    );
    onNotify(`تم تحديث خصائص ${layer.name}.`);
  };

  return (
    <details className={`pro-layer-inspector ${compact ? "is-compact" : ""}`}>
      <summary>
        <span><Icon name="settings" size={14} /> خصائص الطبقة</span>
        <small>
          {layer.pageNumber ? `صفحة ${layer.pageNumber} · ` : ""}
          {layer.readingOrder === undefined
            ? "ترتيب حر"
            : `ترتيب قراءة ${layer.readingOrder + 1}`}
        </small>
      </summary>
      <div className="pro-layer-inspector__body">
        <p className="pro-layer-breadcrumb" aria-label="مسار الطبقة" title={breadcrumb.join(" / ")}>
          <Icon name="folder" size={12} /> {breadcrumb.join(" / ")}
        </p>
        {layer.locked && (
          <p className="form-error" role="status">
            الطبقة مقفلة. افتح القفل قبل تحرير المحتوى أو الخصائص.
          </p>
        )}
        {layer.bounds ? (
          <fieldset disabled={layer.locked}>
            <legend>الموضع والحجم</legend>
            {(["x", "y", "width", "height"] as const).map((field) => (
              <label key={field}>
                <span>{field === "width" ? "العرض" : field === "height" ? "الارتفاع" : field.toUpperCase()}</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={draft[field]}
                  onChange={(event) => updateDraft({ [field]: event.target.value })}
                />
              </label>
            ))}
          </fieldset>
        ) : (
          <p>لا تحمل هذه الطبقة حدودًا مكانية قابلة للتحرير.</p>
        )}
        {layer.kind === "text" && (
          <fieldset disabled={layer.locked}>
            <legend>النص والخط</legend>
            <label className="is-wide">
              <span>محتوى النص</span>
              <textarea
                aria-label="محتوى النص"
                aria-describedby={textCounterId}
                value={draft.fullText}
                maxLength={MAX_LAYER_TEXT_CHARACTERS}
                dir={draft.direction}
                rows={compact ? 3 : 5}
                onChange={(event) => updateDraft({ fullText: event.target.value })}
              />
              <small id={textCounterId}>{Array.from(draft.fullText).length.toLocaleString("ar")} / {MAX_LAYER_TEXT_CHARACTERS.toLocaleString("ar")}</small>
            </label>
            <label>
              <span>الاتجاه</span>
              <select
                value={draft.direction}
                onChange={(event) => updateDraft({ direction: event.target.value as "ltr" | "rtl" })}
              >
                <option value="rtl">من اليمين إلى اليسار</option>
                <option value="ltr">من اليسار إلى اليمين</option>
              </select>
            </label>
            <label>
              <span>المحاذاة</span>
              <select
                value={draft.textAlign}
                onChange={(event) =>
                  updateDraft({
                    textAlign: event.target.value as MetadataDraft["textAlign"],
                  })
                }
              >
                <option value="start">بداية</option>
                <option value="center">وسط</option>
                <option value="end">نهاية</option>
                <option value="justify">ضبط</option>
              </select>
            </label>
            <label className="is-wide">
              <span>مطابقة الخط</span>
              <input
                value={draft.fontFamily}
                maxLength={120}
                onChange={(event) => updateDraft({ fontFamily: event.target.value })}
              />
            </label>
            <label>
              <span>حجم الخط</span>
              <input
                type="number"
                min="1"
                max="500"
                step="0.5"
                value={draft.fontSize}
                onChange={(event) => updateDraft({ fontSize: event.target.value })}
              />
            </label>
          </fieldset>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button type="button" className="secondary-button" onClick={apply} disabled={layer.locked}>
          <Icon name="check" size={13} /> تطبيق الخصائص
        </button>
      </div>
    </details>
  );
}

function createDraft(layer: Layer): MetadataDraft {
  return {
    x: String(layer.bounds?.x ?? 0),
    y: String(layer.bounds?.y ?? 0),
    width: String(layer.bounds?.width ?? 0),
    height: String(layer.bounds?.height ?? 0),
    direction: layer.direction ?? "rtl",
    textAlign: layer.textAlign ?? "start",
    fontFamily: layer.fontFamily ?? "Noto Sans Arabic",
    fontSize: String(layer.fontSize ?? 16),
    fullText: layer.fullText ?? "",
  };
}

function createLayerBreadcrumb(
  layer: Layer,
  layers: readonly Layer[],
): string[] {
  const byId = new Map(layers.map((candidate) => [candidate.id, candidate]));
  const path = [layer.name];
  const visited = new Set([layer.id]);
  let parentId = layer.parentId ?? null;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    path.unshift(parent.name);
    parentId = parent.parentId ?? null;
  }
  return path;
}
