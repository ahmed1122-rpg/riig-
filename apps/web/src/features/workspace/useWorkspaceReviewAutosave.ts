import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import type { Layer } from "../../types";
import { ApiError, updateLayerDocument } from "../../lib/api";
import {
  collectLayerReviewUpdates,
  snapshotLayerReview,
  type LayerReviewSnapshot,
} from "./layerReviewState";
import type { WorkspaceSaveState } from "./WorkspaceChrome";

interface WorkspaceReviewAutosaveOptions {
  projectId?: string;
  sourceVersionId?: string;
  persistedSource: boolean;
  revision?: number;
  layers: Layer[];
  setRevision: Dispatch<SetStateAction<number | undefined>>;
  setSaveState: Dispatch<SetStateAction<WorkspaceSaveState>>;
  onNotify: (message: string) => void;
  onRevisionConflict: (error: unknown) => Promise<void>;
}

interface WorkspaceReviewAutosave {
  flushLayerReview: () => Promise<number>;
  hasUnsavedReview: () => boolean;
  saveInFlightRef: MutableRefObject<boolean>;
  adoptSavedReview: (layers: Layer[], revision: number) => void;
  resetSavedReview: () => void;
}

export function useWorkspaceReviewAutosave(
  options: WorkspaceReviewAutosaveOptions,
): WorkspaceReviewAutosave {
  const saveTimerRef = useRef<number | null>(null);
  const savedReviewRef = useRef<LayerReviewSnapshot>(new Map());
  const revisionRef = useRef<number | undefined>(options.revision);
  const layersRef = useRef<Layer[]>(options.layers);
  const savePromiseRef = useRef<Promise<number> | null>(null);
  const saveInFlightRef = useRef(false);
  layersRef.current = options.layers;
  revisionRef.current = options.revision;

  const adoptSavedReview = useCallback(
    (layers: Layer[], revision: number) => {
      savedReviewRef.current = snapshotLayerReview(layers);
      revisionRef.current = revision;
      options.setRevision(revision);
      options.setSaveState("saved");
    },
    [options.setRevision, options.setSaveState],
  );

  const resetSavedReview = useCallback(() => {
    savedReviewRef.current = new Map();
    revisionRef.current = undefined;
    options.setRevision(undefined);
    options.setSaveState("idle");
  }, [options.setRevision, options.setSaveState]);

  const hasUnsavedReview = useCallback(
    () =>
      Boolean(
        options.persistedSource &&
          options.projectId &&
          options.sourceVersionId &&
          revisionRef.current !== undefined &&
          collectLayerReviewUpdates(
            layersRef.current,
            savedReviewRef.current,
          ).length > 0,
      ),
    [
      options.persistedSource,
      options.projectId,
      options.sourceVersionId,
    ],
  );

  const flushLayerReview = useCallback((): Promise<number> => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (savePromiseRef.current) return savePromiseRef.current;

    const drainLatestReview = async (): Promise<number> => {
      while (true) {
        const revision = revisionRef.current;
        if (!options.projectId || !options.sourceVersionId || revision === undefined) {
          throw new Error("وثيقة الطبقات غير جاهزة للحفظ.");
        }
        const currentLayers = layersRef.current;
        const updates = collectLayerReviewUpdates(
          currentLayers,
          savedReviewRef.current,
        );
        if (updates.length === 0) {
          options.setSaveState("saved");
          return revision;
        }

        const submittedSnapshot = snapshotLayerReview(currentLayers);
        options.setSaveState("saving");
        try {
          const updated = await updateLayerDocument(
            options.projectId,
            options.sourceVersionId,
            revision,
            updates,
          );
          savedReviewRef.current = submittedSnapshot;
          revisionRef.current = updated.revision;
          options.setRevision(updated.revision);
        } catch (error) {
          options.setSaveState("error");
          await options.onRevisionConflict(error);
          throw error;
        }
      }
    };

    const operation = drainLatestReview();
    savePromiseRef.current = operation;
    const clearOperation = () => {
      if (savePromiseRef.current === operation) savePromiseRef.current = null;
    };
    void operation.then(clearOperation, clearOperation);
    return operation;
  }, [
    options.onRevisionConflict,
    options.projectId,
    options.setRevision,
    options.setSaveState,
    options.sourceVersionId,
  ]);

  useEffect(() => {
    if (
      !options.persistedSource ||
      options.revision === undefined ||
      saveInFlightRef.current
    ) {
      return;
    }
    const updates = collectLayerReviewUpdates(
      options.layers,
      savedReviewRef.current,
    );
    if (updates.length === 0) return;
    options.setSaveState("idle");
    const timeout = window.setTimeout(() => {
      saveTimerRef.current = null;
      void flushLayerReview().catch((error: unknown) => {
        options.onNotify(
          error instanceof ApiError
            ? error.message
            : "تعذر حفظ مراجعة الطبقات تلقائيًا.",
        );
      });
    }, 700);
    saveTimerRef.current = timeout;
    return () => {
      window.clearTimeout(timeout);
      if (saveTimerRef.current === timeout) saveTimerRef.current = null;
    };
  }, [
    flushLayerReview,
    options.layers,
    options.onNotify,
    options.persistedSource,
    options.revision,
    options.setSaveState,
  ]);

  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedReview()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedReview]);

  return {
    flushLayerReview,
    hasUnsavedReview,
    saveInFlightRef,
    adoptSavedReview,
    resetSavedReview,
  };
}
