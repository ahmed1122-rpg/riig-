import type {
  LayerCommandScope,
  LayerDocumentCommand,
} from "@motionprep/contracts";

type LayerDocumentCommandRequest =
  | {
      kind: "normalize-names";
      scope: LayerCommandScope;
    }
  | {
      kind: "arrange-reading-order";
      scope: LayerCommandScope;
      order: "reading" | "reverse";
    }
  | {
      kind: "update-state";
      scope: LayerCommandScope;
      visible?: boolean | undefined;
      locked?: boolean | undefined;
    }
  | {
      kind: "move-layer";
      layerId: string;
      targetLayerId: string;
      position: "before" | "after";
    };

export function toLayerDocumentCommand(
  command: LayerDocumentCommandRequest,
): LayerDocumentCommand {
  if (command.kind !== "update-state") return command;
  return {
    kind: command.kind,
    scope: command.scope,
    ...(command.visible === undefined ? {} : { visible: command.visible }),
    ...(command.locked === undefined ? {} : { locked: command.locked }),
  };
}
