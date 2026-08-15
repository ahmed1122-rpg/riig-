import { useEffect, useState } from "react";
import type { LayerDocumentCommand } from "@motionprep/contracts";
import {
  canonicalLayerName,
  normalizeLayerName,
} from "@motionprep/layer-domain";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";
import { isPageLayer } from "./workspaceLayerKinds";

interface MobileLayerActionsProps {
  layer: Layer;
  layers: readonly Layer[];
  onLayersChange: (layers: Layer[]) => void;
  onLayerCommand: (command: LayerDocumentCommand) => Promise<void>;
  onNotify: (message: string) => void;
}

export function MobileLayerActions({
  layer,
  layers,
  onLayersChange,
  onLayerCommand,
  onNotify,
}: MobileLayerActionsProps) {
  const [renameDraft, setRenameDraft] = useState(layer.name);
  const [renameError, setRenameError] = useState("");
  const structural = isPageLayer(layer) || layer.kind === "group" || layer.fixed;
  const contentLocked = structural || layer.locked;

  useEffect(() => {
    setRenameDraft(layer.name);
    setRenameError("");
  }, [layer.id, layer.name]);

  const updateLayer = (changes: Partial<Layer>, allowWhileLocked = false) => {
    if (structural || (layer.locked && !allowWhileLocked)) return;
    onLayersChange(
      layers.map((candidate) =>
        candidate.id === layer.id ? { ...candidate, ...changes } : candidate,
      ),
    );
  };

  const saveRename = () => {
    if (contentLocked) return;
    const nextName = normalizeLayerName(renameDraft);
    const duplicate = layers.some(
      (candidate) =>
        candidate.id !== layer.id &&
        (candidate.pageNumber ?? 1) === (layer.pageNumber ?? 1) &&
        (candidate.parentId ?? null) === (layer.parentId ?? null) &&
        canonicalLayerName(candidate.name) === canonicalLayerName(nextName),
    );
    if (duplicate) {
      setRenameError("الاسم مستخدم داخل المجموعة نفسها.");
      return;
    }
    setRenameDraft(nextName);
    setRenameError("");
    if (nextName !== layer.name) updateLayer({ name: nextName });
  };

  const move = async (direction: -1 | 1) => {
    if (contentLocked) return;
    const siblings = layers.filter(
      (candidate) =>
        !isPageLayer(candidate) &&
        candidate.kind !== "group" &&
        (candidate.pageNumber ?? 1) === (layer.pageNumber ?? 1) &&
        (candidate.parentId ?? null) === (layer.parentId ?? null),
    );
    const index = siblings.findIndex((candidate) => candidate.id === layer.id);
    const target = siblings[index + direction];
    if (!target) return;
    try {
      await onLayerCommand({
        kind: "move-layer",
        layerId: layer.id,
        targetLayerId: target.id,
        position: direction < 0 ? "before" : "after",
      });
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "تعذر تحريك الطبقة.");
    }
  };

  return (
    <section className="pro-mobile-layer-actions" aria-label={`تعديل ${layer.name}`}>
      <header>
        <strong>تعديل الطبقة النشطة</strong>
        <span>{structural ? "عنصر بنيوي محمي" : layer.locked ? "مقفلة — افتح القفل للتعديل" : layer.kind === "text" ? "نص" : "صورة"}</span>
      </header>
      <label>
        <span>اسم الطبقة</span>
        <input
          value={renameDraft}
          disabled={contentLocked}
          aria-invalid={Boolean(renameError)}
          aria-describedby={renameError ? "mobile-layer-rename-error" : undefined}
          onChange={(event) => {
            setRenameDraft(event.target.value);
            setRenameError("");
          }}
          onBlur={saveRename}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setRenameDraft(layer.name);
              setRenameError("");
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      {renameError && <small id="mobile-layer-rename-error" role="alert">{renameError}</small>}
      <div className="pro-mobile-layer-action-buttons">
        <button type="button" disabled={structural} aria-pressed={layer.visible} onClick={() => updateLayer({ visible: !layer.visible }, true)}>
          <Icon name={layer.visible ? "eye" : "eyeOff"} size={15} />
          {layer.visible ? "إخفاء" : "إظهار"}
        </button>
        <button type="button" disabled={structural} aria-pressed={layer.locked} onClick={() => updateLayer({ locked: !layer.locked }, true)}>
          <Icon name={layer.locked ? "lock" : "unlock"} size={15} />
          {layer.locked ? "فتح القفل" : "قفل"}
        </button>
        <button type="button" disabled={contentLocked} aria-label="تحريك الطبقة لأعلى" onClick={() => void move(-1)}>
          <Icon name="arrowUp" size={15} />
        </button>
        <button type="button" disabled={contentLocked} aria-label="تحريك الطبقة لأسفل" onClick={() => void move(1)}>
          <Icon name="arrowDown" size={15} />
        </button>
      </div>
      <label className="pro-mobile-layer-opacity">
        <span>الشفافية <output>{layer.opacity}%</output></span>
        <input
          type="range"
          aria-label="الشفافية"
          min="0"
          max="100"
          value={layer.opacity}
          disabled={contentLocked}
          onChange={(event) => updateLayer({ opacity: Number(event.target.value) })}
        />
      </label>
    </section>
  );
}
