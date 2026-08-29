import { useEffect, useState } from "react";
import { MAX_IMAGE_LAYERS } from "@motionprep/contracts";
import { Icon } from "../../shared/Icon";
import type { Layer, ProjectMode } from "../../types";
import type { ExportGenerationState } from "./exportFormatState";
import { renameExportLayer } from "./exportLayerRename";
import { moveExportLayer } from "./exportReviewLayers";
import { ExportReviewLayerList } from "./ExportReviewLayerList";

interface ExportLayerReviewPanelProps {
  mode: ProjectMode;
  allLayers: Layer[];
  reviewableLayers: Layer[];
  selected: Layer | undefined;
  selectedLayerId: string;
  pageCount: number;
  fixedBackground: boolean;
  generationState: ExportGenerationState;
  onSelect: (id: string) => void;
  onLayersChange: (layers: Layer[]) => void;
  onInvalidate: () => void;
}

export function ExportLayerReviewPanel({
  mode,
  allLayers,
  reviewableLayers,
  selected,
  selectedLayerId,
  pageCount,
  fixedBackground,
  generationState,
  onSelect,
  onLayersChange,
  onInvalidate,
}: ExportLayerReviewPanelProps) {
  const [renameDraft, setRenameDraft] = useState("");
  const [renameError, setRenameError] = useState("");
  const working = generationState === "working";

  useEffect(() => {
    setRenameDraft(selected?.name ?? "");
    setRenameError("");
  }, [selected?.id, selected?.name]);

  const updateLayer = (changes: Partial<Layer>) => {
    if (!selected || selected.kind === "group" || selected.fixed) return;
    onInvalidate();
    onLayersChange(
      allLayers.map((layer) =>
        layer.id === selected.id ? { ...layer, ...changes } : layer,
      ),
    );
  };

  const commitLayerName = () => {
    const result = renameExportLayer(
      allLayers,
      selected,
      renameDraft,
      fixedBackground,
    );
    if (result === null) return;
    if (result === false) {
      setRenameError("الاسم مستخدم داخل المجلد نفسه.");
      return;
    }
    const [name, renamedLayers] = result;
    setRenameDraft(name);
    setRenameError("");
    if (selected && name !== selected.name) {
      onInvalidate();
      onLayersChange(renamedLayers);
    }
  };

  const moveLayer = (direction: -1 | 1) => {
    if (!selected || fixedBackground) return;
    const result = moveExportLayer(
      allLayers,
      reviewableLayers,
      selected.id,
      direction,
    );
    if (!result) return;
    onInvalidate();
    onLayersChange(result.layers);
  };

  return (
    <aside className="export-layer-review" aria-label="مراجعة الطبقات">
      <div className="review-section-heading">
        <div>
          <strong>الطبقات</strong>
          <small>
            {mode === "image"
              ? `${reviewableLayers.length} / ${MAX_IMAGE_LAYERS} طبقة`
              : `${arabicLayerCount(reviewableLayers.length)} في ${arabicPageCount(pageCount)}`}
          </small>
        </div>
        <span className={mode === "image" ? "review-count" : "review-count is-unlimited"}>
          {mode === "image" ? `${reviewableLayers.length}/15` : "بلا حد"}
        </span>
      </div>

      <ExportReviewLayerList
        layers={reviewableLayers}
        selectedLayerId={selectedLayerId}
        onSelect={onSelect}
      />

      {selected ? (
        <div className="selected-layer-editor">
          <label className="rename-field">
            <span>اسم الطبقة</span>
            <input
              value={renameDraft}
              onChange={(event) => {
                setRenameDraft(event.target.value);
                setRenameError("");
              }}
              onBlur={commitLayerName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitLayerName();
                } else if (event.key === "Escape") {
                  setRenameDraft(selected.name);
                  setRenameError("");
                }
              }}
              disabled={fixedBackground || working}
              aria-invalid={Boolean(renameError)}
              aria-describedby={
                fixedBackground
                  ? "fixed-background-note"
                  : renameError
                    ? "export-rename-error"
                    : undefined
              }
            />
            {renameError ? (
              <small id="export-rename-error" role="alert">{renameError}</small>
            ) : null}
          </label>
          {fixedBackground ? (
            <p id="fixed-background-note" className="fixed-layer-note">
              <Icon name="lock" size={13} />
              الخلفية البيضاء ثابتة؛ لا يمكن إعادة تسميتها أو فتحها أو حذفها.
            </p>
          ) : null}
          <div className="layer-quick-actions">
            <button
              type="button"
              onClick={() => updateLayer({ visible: !selected.visible })}
              disabled={fixedBackground || working}
            >
              <Icon name={selected.visible ? "eye" : "eyeOff"} size={15} />
              {selected.visible ? "ظاهرة" : "مخفية"}
            </button>
            <button
              type="button"
              onClick={() => updateLayer({ locked: !selected.locked })}
              disabled={fixedBackground || working}
            >
              <Icon name={selected.locked ? "lock" : "unlock"} size={15} />
              {selected.locked ? "مقفلة" : "مفتوحة"}
            </button>
            <button
              type="button"
              onClick={() => moveLayer(-1)}
              disabled={fixedBackground || working}
              title="يحفظ الترتيب تلقائيًا في وثيقة الطبقات"
              aria-label="تحريك الطبقة إلى أعلى"
            >
              <Icon name="arrowUp" size={15} />
            </button>
            <button
              type="button"
              onClick={() => moveLayer(1)}
              disabled={fixedBackground || working}
              title="يحفظ الترتيب تلقائيًا في وثيقة الطبقات"
              aria-label="تحريك الطبقة إلى أسفل"
            >
              <Icon name="arrowDown" size={15} />
            </button>
          </div>
          <label className="opacity-field">
            <span>الشفافية <b>{selected.opacity}%</b></span>
            <input
              type="range"
              min="0"
              max="100"
              value={selected.opacity}
              disabled={fixedBackground || working}
              onChange={(event) => updateLayer({ opacity: Number(event.target.value) })}
            />
          </label>
        </div>
      ) : null}
    </aside>
  );
}

function arabicLayerCount(count: number): string {
  if (count === 1) return "طبقة فعلية واحدة";
  if (count === 2) return "طبقتان فعليتان";
  if (count >= 3 && count <= 10) return `${count} طبقات فعلية`;
  return `${count} طبقة فعلية`;
}

function arabicPageCount(count: number): string {
  if (count === 1) return "صفحة واحدة";
  if (count === 2) return "صفحتين";
  if (count >= 3 && count <= 10) return `${count} صفحات`;
  return `${count} صفحة`;
}
