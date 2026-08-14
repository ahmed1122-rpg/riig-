import { useEffect, useRef, type RefObject } from "react";
import {
  activateModalEnvironment,
  trapModalFocus,
} from "../../shared/modal-environment";

interface ExportReviewDialogOptions {
  backdropRef: RefObject<HTMLDivElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  dialogRef: RefObject<HTMLElement | null>;
  isWorking: boolean;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}

export function useExportReviewDialog({
  backdropRef,
  closeButtonRef,
  dialogRef,
  isWorking,
  onClose,
  returnFocusTo,
}: ExportReviewDialogOptions) {
  const onCloseRef = useRef(onClose);
  const isWorkingRef = useRef(isWorking);
  onCloseRef.current = onClose;
  isWorkingRef.current = isWorking;

  useEffect(() => {
    const restoreFocusTo = returnFocusTo ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const backdrop = backdropRef.current;
    const dialog = dialogRef.current;
    const restoreEnvironment = activateModalEnvironment({ modalBranch: backdrop });

    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isWorkingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (dialog) {
        trapModalFocus(event, dialog, {
          visibility: "rendered",
          recoverOutside: true,
          focusContainerWhenEmpty: true,
        });
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreEnvironment();
      window.requestAnimationFrame(() => restoreFocusTo?.focus());
    };
  }, [backdropRef, closeButtonRef, dialogRef, returnFocusTo]);
}
