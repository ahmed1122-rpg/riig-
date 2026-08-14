import type { Layer } from "../../types";
import { Icon } from "../../shared/Icon";

export function ExportReviewLayerList({
  layers,
  selectedLayerId,
  onSelect,
}: {
  layers: readonly Layer[];
  selectedLayerId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="export-layer-list">
      {layers.map((layer) => (
        <button
          key={layer.id}
          className={`export-layer-item ${layer.id === selectedLayerId ? "is-selected" : ""} ${layer.kind === "page" || layer.fixed ? "is-fixed" : ""}`}
          type="button"
          onClick={() => onSelect(layer.id)}
        >
          <Icon name="grip" size={15} />
          <span className="layer-swatch" style={{ "--layer-color": layer.color } as React.CSSProperties}>{layer.kind === "text" ? "ن" : ""}</span>
          <span><strong dir={/^[A-Za-z0-9]/.test(layer.name.slice(1)) ? "ltr" : "rtl"}>{layer.name}</strong><small>{layer.kind === "page" ? "خلفية بيضاء ثابتة" : `${layer.opacity}% · ${layer.visible ? "ظاهرة" : "مخفية"}`}</small></span>
          {layer.kind === "page" && <Icon name="lock" size={14} />}
        </button>
      ))}
    </div>
  );
}
