import {
  useCallback,
  useEffect,
  useRef,
  type MutableRefObject,
} from "react";

export interface DocumentCommandContext {
  baseRevision: number | undefined;
  signal: AbortSignal;
}

export interface DocumentCommandCoordinator {
  run<T>(
    command: (context: DocumentCommandContext) => Promise<T>,
    options?: { flush?: boolean; allowIdentityChange?: boolean },
  ): Promise<T>;
  cancelPending(): void;
}

interface CoordinatorOptions {
  projectId?: string;
  sourceVersionId?: string;
  flushLayerReview: () => Promise<number>;
  saveInFlightRef: MutableRefObject<boolean>;
}

export class DocumentCommandCancelledError extends Error {
  constructor() {
    super("أُلغيت العملية.");
    this.name = "DocumentCommandCancelledError";
  }
}

export function useDocumentCommandCoordinator(
  options: CoordinatorOptions,
): DocumentCommandCoordinator {
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const identityRef = useRef("");
  const generationRef = useRef(0);
  const activeRef = useRef<{
    controller: AbortController;
    allowIdentityChange: boolean;
  } | null>(null);
  const identity = `${options.projectId ?? "none"}:${options.sourceVersionId ?? "none"}`;

  const cancelPending = useCallback(() => {
    generationRef.current += 1;
    activeRef.current?.controller.abort();
  }, []);

  useEffect(() => {
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    generationRef.current += 1;
    if (!activeRef.current?.allowIdentityChange) {
      activeRef.current?.controller.abort();
    }
  }, [identity]);

  useEffect(() => () => {
    activeRef.current?.controller.abort();
  }, []);

  const run = useCallback(
    async <T,>(
      command: (context: DocumentCommandContext) => Promise<T>,
      runOptions: {
        flush?: boolean;
        allowIdentityChange?: boolean;
      } = {},
    ): Promise<T> => {
      const generation = generationRef.current;
      const execute = async (): Promise<T> => {
        if (generationRef.current !== generation) {
          throw new DocumentCommandCancelledError();
        }
        const controller = new AbortController();
        activeRef.current = {
          controller,
          allowIdentityChange: runOptions.allowIdentityChange === true,
        };
        options.saveInFlightRef.current = true;
        try {
          const baseRevision = runOptions.flush === false
            ? undefined
            : await options.flushLayerReview();
          if (controller.signal.aborted) {
            throw new DocumentCommandCancelledError();
          }
          const result = await command({
            baseRevision,
            signal: controller.signal,
          });
          if (controller.signal.aborted) {
            throw new DocumentCommandCancelledError();
          }
          return result;
        } finally {
          if (activeRef.current?.controller === controller) {
            activeRef.current = null;
          }
          options.saveInFlightRef.current = false;
        }
      };
      const pending = queueRef.current.then(execute, execute);
      queueRef.current = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    [options.flushLayerReview, options.saveInFlightRef],
  );

  return { run, cancelPending };
}
