import type { Layer } from "../../types";
import { LayerRow } from "./LayerDockPanels";

export type LayerDropPosition = "before" | "after";

export interface LayerDropTarget {
  layerId: string;
  position: LayerDropPosition;
}

interface LayerDockInteractiveRowProps {
  layer: Layer;
  selected: boolean;
  active: boolean;
  duplicate: boolean;
  canReorder: boolean;
  renaming: boolean;
  renameDraft: string;
  renameError: string;
  draggedLayerId: string | undefined;
  dragOverTarget: LayerDropTarget | undefined;
  onRenameDraftChange: (value: string) => void;
  onSelect: (event: React.MouseEvent | React.KeyboardEvent) => void;
  onStartRename: () => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onMove: (direction: -1 | 1) => void;
  onNavigate: (direction: "previous" | "next" | "first" | "last") => void;
  onMoveTo: (
    sourceId: string,
    targetId: string,
    position: LayerDropPosition,
  ) => void;
  onDraggedLayerChange: (id?: string) => void;
  onDragOverTargetChange: (target?: LayerDropTarget) => void;
}

export function layerDropPosition(
  pointerY: number,
  targetTop: number,
  targetHeight: number,
): LayerDropPosition {
  return pointerY < targetTop + targetHeight / 2 ? "before" : "after";
}

function dropTarget(
  event: React.DragEvent<HTMLDivElement>,
  layerId: string,
): LayerDropTarget {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    layerId,
    position: layerDropPosition(event.clientY, bounds.top, bounds.height),
  };
}

export function LayerDockInteractiveRow({
  layer,
  selected,
  active,
  duplicate,
  canReorder,
  renaming,
  renameDraft,
  renameError,
  draggedLayerId,
  dragOverTarget,
  onRenameDraftChange,
  onSelect,
  onStartRename,
  onSaveRename,
  onCancelRename,
  onToggleVisible,
  onToggleLock,
  onMove,
  onNavigate,
  onMoveTo,
  onDraggedLayerChange,
  onDragOverTargetChange,
}: LayerDockInteractiveRowProps) {
  return (
    <LayerRow
      layer={layer}
      selected={selected}
      active={active}
      duplicate={duplicate}
      renaming={renaming}
      renameDraft={renameDraft}
      renameError={renameError}
      canReorder={canReorder}
      dragging={draggedLayerId === layer.id}
      dragOverPosition={
        dragOverTarget?.layerId === layer.id
          ? dragOverTarget.position
          : undefined
      }
      onRenameDraftChange={onRenameDraftChange}
      onSelect={onSelect}
      onStartRename={onStartRename}
      onSaveRename={onSaveRename}
      onCancelRename={onCancelRename}
      onToggleVisible={onToggleVisible}
      onToggleLock={onToggleLock}
      onMove={onMove}
      onNavigate={onNavigate}
      onDragStart={(event) => {
        onDraggedLayerChange(layer.id);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", layer.id);
      }}
      onDragOver={(event) => {
        if (!draggedLayerId || draggedLayerId === layer.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOverTargetChange(dropTarget(event, layer.id));
      }}
      onDrop={(event) => {
        event.preventDefault();
        const sourceId =
          draggedLayerId || event.dataTransfer.getData("text/plain");
        const target = dropTarget(event, layer.id);
        if (sourceId) onMoveTo(sourceId, target.layerId, target.position);
        onDraggedLayerChange(undefined);
        onDragOverTargetChange(undefined);
      }}
      onDragEnd={() => {
        onDraggedLayerChange(undefined);
        onDragOverTargetChange(undefined);
      }}
    />
  );
}
