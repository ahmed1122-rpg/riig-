import type { Layer } from "../../types";
import { LayerRow } from "./LayerDockPanels";

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
  dragOverLayerId: string | undefined;
  onRenameDraftChange: (value: string) => void;
  onSelect: (event: React.MouseEvent | React.KeyboardEvent) => void;
  onStartRename: () => void;
  onSaveRename: () => void;
  onCancelRename: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  onMove: (direction: -1 | 1) => void;
  onNavigate: (direction: "previous" | "next" | "first" | "last") => void;
  onMoveTo: (sourceId: string, targetId: string) => void;
  onDraggedLayerChange: (id?: string) => void;
  onDragOverLayerChange: (id?: string) => void;
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
  dragOverLayerId,
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
  onDragOverLayerChange,
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
      dragOver={dragOverLayerId === layer.id}
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
        onDragOverLayerChange(layer.id);
      }}
      onDrop={(event) => {
        event.preventDefault();
        const sourceId =
          draggedLayerId || event.dataTransfer.getData("text/plain");
        if (sourceId) onMoveTo(sourceId, layer.id);
        onDraggedLayerChange(undefined);
        onDragOverLayerChange(undefined);
      }}
      onDragEnd={() => {
        onDraggedLayerChange(undefined);
        onDragOverLayerChange(undefined);
      }}
    />
  );
}
