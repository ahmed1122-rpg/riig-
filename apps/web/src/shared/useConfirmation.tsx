import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";

export interface ConfirmationRequest {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
}

interface PendingConfirmation extends ConfirmationRequest {
  id: number;
}

export function useConfirmation() {
  const [pending, setPending] = useState<PendingConfirmation>();
  const resolverRef = useRef<((confirmed: boolean) => void) | null>(null);
  const sequenceRef = useRef(0);

  const settle = useCallback((confirmed: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setPending(undefined);
    resolve?.(confirmed);
  }, []);

  const requestConfirmation = useCallback(
    (request: ConfirmationRequest): Promise<boolean> => {
      resolverRef.current?.(false);
      sequenceRef.current += 1;
      setPending({ ...request, id: sequenceRef.current });
      return new Promise((resolve) => {
        resolverRef.current = resolve;
      });
    },
    [],
  );

  useEffect(
    () => () => {
      resolverRef.current?.(false);
      resolverRef.current = null;
    },
    [],
  );

  const confirmationDialog =
    pending && typeof document !== "undefined"
      ? createPortal(
          <Dialog
            key={pending.id}
            role="alertdialog"
            title={pending.title}
            description={pending.description}
            className="confirm-dialog"
            eyebrow="تأكيد قبل المتابعة"
            onClose={() => settle(false)}
            footer={
              <>
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => settle(false)}
                >
                  {pending.cancelLabel ?? "إلغاء"}
                </button>
                <button
                  type="button"
                  className={
                    pending.tone === "danger"
                      ? "danger-button"
                      : "button button--primary"
                  }
                  onClick={() => settle(true)}
                >
                  <Icon name="warning" size={15} />
                  {pending.confirmLabel ?? "متابعة"}
                </button>
              </>
            }
          >
            <p>{pending.description}</p>
          </Dialog>,
          document.body,
        )
      : null;

  return { requestConfirmation, confirmationDialog };
}
