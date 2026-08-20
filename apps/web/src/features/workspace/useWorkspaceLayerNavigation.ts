import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { ConfirmationRequest } from "../../shared/useConfirmation";
import type { Layer, ProjectMode } from "../../types";
import { isPageLayer } from "./workspaceLayerKinds";

interface WorkspaceLayerNavigationOptions {
  mode: ProjectMode;
  layers: readonly Layer[];
  pdfPages: ReadonlyArray<{ pageNumber: number; width: number; height: number }>;
  activePdfPage: number;
  editorDraftDirty: boolean;
  requestConfirmation: (request: ConfirmationRequest) => Promise<boolean>;
  setActivePdfPage: Dispatch<SetStateAction<number>>;
  setPdfPageSize: Dispatch<SetStateAction<{ width: number; height: number } | undefined>>;
  setEditorDraftDirty: Dispatch<SetStateAction<boolean>>;
  setSelectedIds: Dispatch<SetStateAction<string[]>>;
  setActiveLayerId: Dispatch<SetStateAction<string>>;
}

export function useWorkspaceLayerNavigation(options: WorkspaceLayerNavigationOptions) {
  const {
    mode,
    layers,
    pdfPages,
    activePdfPage,
    editorDraftDirty,
    requestConfirmation,
    setActivePdfPage,
    setPdfPageSize,
    setEditorDraftDirty,
    setSelectedIds,
    setActiveLayerId,
  } = options;
  const navigateWorkspacePdfPage = useCallback(
    async (pageNumber: number): Promise<boolean> => {
      if (mode !== "book" || pageNumber === activePdfPage) return true;
      if (
        editorDraftDirty &&
        !(await requestConfirmation({
          title: "تجاهل المناطق غير المحفوظة؟",
          description: "الانتقال إلى صفحة أخرى سيتجاهل مناطق PDF الحالية غير المطبقة.",
          confirmLabel: "تجاهل والانتقال",
          tone: "danger",
        }))
      ) {
        return false;
      }
      const page = pdfPages.find(
        (candidate) => candidate.pageNumber === pageNumber,
      );
      setActivePdfPage(pageNumber);
      setPdfPageSize(
        page ? { width: page.width, height: page.height } : undefined,
      );
      setEditorDraftDirty(false);
      const preferredLayer =
        layers.find((layer) =>
          (layer.pageNumber ?? 1) === pageNumber &&
          layer.kind !== "group" &&
          !isPageLayer(layer),
        ) ??
        layers.find((layer) =>
          (layer.pageNumber ?? 1) === pageNumber && layer.kind !== "group",
        );
      if (preferredLayer) {
        setSelectedIds([preferredLayer.id]);
        setActiveLayerId(preferredLayer.id);
      }
      return true;
    },
    [
      activePdfPage,
      editorDraftDirty,
      layers,
      mode,
      pdfPages,
      requestConfirmation,
      setActiveLayerId,
      setActivePdfPage,
      setEditorDraftDirty,
      setPdfPageSize,
      setSelectedIds,
    ],
  );

  const selectWorkspaceLayer = useCallback(
    async (id: string, nextSelectedIds: string[] = [id]) => {
      const layer = layers.find((candidate) => candidate.id === id);
      if (layer?.kind === "group") return;
      if (
        mode === "book" &&
        layer?.pageNumber &&
        !(await navigateWorkspacePdfPage(layer.pageNumber))
      ) {
        return;
      }
      setSelectedIds(nextSelectedIds);
      setActiveLayerId(id);
    },
    [layers, mode, navigateWorkspacePdfPage, setActiveLayerId, setSelectedIds],
  );

  return { navigateWorkspacePdfPage, selectWorkspaceLayer };
}
