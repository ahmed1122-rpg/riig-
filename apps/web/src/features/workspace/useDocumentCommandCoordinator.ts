import {
  useCallback,
  useRef,
  type MutableRefObject,
} from "react";

export interface DocumentCommandContext {
  baseRevision: number | undefined;
}

export interface DocumentCommandCoordinator {
  run<T>(
    command: (context: DocumentCommandContext) => Promise<T>,
    options?: { flush?: boolean; allowIdentityChange?: boolean },
  ): Promise<T>;
}

interface CoordinatorOptions {
  projectId?: string;
  sourceVersionId?: string;
  flushLayerReview: () => Promise<number>;
  saveInFlightRef: MutableRefObject<boolean>;
}

export class StaleDocumentCommandError extends Error {
  constructor() {
    super("اكتملت العملية لإصدار مصدر لم يعد مفتوحًا؛ لم تُعتمد نتيجتها في الواجهة.");
    this.name = "StaleDocumentCommandError";
  }
}

export function useDocumentCommandCoordinator(
  options: CoordinatorOptions,
): DocumentCommandCoordinator {
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const identityRef = useRef("");
  const generationRef = useRef(0);
  const identity = `${options.projectId ?? "none"}:${options.sourceVersionId ?? "none"}`;
  if (identityRef.current !== identity) {
    identityRef.current = identity;
    generationRef.current += 1;
  }

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
        options.saveInFlightRef.current = true;
        try {
          const baseRevision = runOptions.flush === false
            ? undefined
            : await options.flushLayerReview();
          const result = await command({ baseRevision });
          if (
            !runOptions.allowIdentityChange &&
            generationRef.current !== generation
          ) {
            throw new StaleDocumentCommandError();
          }
          return result;
        } finally {
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

  return { run };
}
