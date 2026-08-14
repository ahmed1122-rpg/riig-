import { MAX_LAYER_TEXT_CHARACTERS } from "@motionprep/contracts";
import type { CSSProperties } from "react";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";

export interface PdfTextEdit {
  layerId: string;
  draft: string;
}

function positionedTextStyle(
  layer: Layer,
  pageSize: { width: number; height: number },
): CSSProperties {
  const bounds = layer.bounds;
  if (!bounds) return {};
  return {
    insetInlineStart: `${(bounds.x / pageSize.width) * 100}%`,
    top: `${(bounds.y / pageSize.height) * 100}%`,
    width: `${(bounds.width / pageSize.width) * 100}%`,
    minHeight: `${(bounds.height / pageSize.height) * 100}%`,
    textAlign: layer.textAlign ?? "start",
    fontSize: `${Math.max(
      6,
      Math.min(22, ((layer.fontSize ?? 12) / pageSize.width) * 410),
    )}px`,
  };
}

export function PdfExtractedTextPage({
  layers,
  pageNumber,
  pageSize,
  selectedLayerId,
  textEdit,
  onTextEditChange,
  onTextEditFinish,
}: {
  layers: readonly Layer[];
  pageNumber: number;
  pageSize?: { width: number; height: number } | undefined;
  selectedLayerId: string;
  textEdit?: PdfTextEdit | undefined;
  onTextEditChange: (edit: PdfTextEdit) => void;
  onTextEditFinish: (save: boolean) => void;
}) {
  if (!pageSize || layers.length === 0) {
    return (
      <div className="preview-unavailable" role="status">
        <Icon name="warning" size={18} />
        لا توجد طبقات نص مستخرجة في هذه الصفحة.
      </div>
    );
  }
  return (
    <div
      className={`pdf-extracted-page ${textEdit ? "is-editing-text" : ""}`}
      role="region"
      aria-label={`النص المستخرج من الصفحة ${pageNumber}`}
    >
      {layers.map((layer) =>
        textEdit?.layerId === layer.id ? (
          <textarea
            key={layer.id}
            autoFocus
            className="pdf-inline-text-editor"
            dir={layer.direction ?? "auto"}
            style={positionedTextStyle(layer, pageSize)}
            value={textEdit.draft}
            maxLength={MAX_LAYER_TEXT_CHARACTERS}
            aria-label={`تحرير نص ${layer.name}`}
            onChange={(event) =>
              onTextEditChange({
                layerId: layer.id,
                draft: event.target.value,
              })
            }
            onBlur={() => onTextEditFinish(true)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onTextEditFinish(false);
              }
              if (
                event.key === "Enter" &&
                (event.ctrlKey || event.metaKey)
              ) {
                event.preventDefault();
                onTextEditFinish(true);
              }
            }}
          />
        ) : (
          <span
            key={layer.id}
            className={`pdf-extracted-text ${selectedLayerId === layer.id ? "is-selected" : ""}`}
            dir={layer.direction ?? "auto"}
            style={{
              ...positionedTextStyle(layer, pageSize),
              opacity: layer.opacity / 100,
            }}
            title={`${layer.name} · انقر مرتين للتحرير`}
          >
            {layer.fullContent}
          </span>
        ),
      )}
    </div>
  );
}
