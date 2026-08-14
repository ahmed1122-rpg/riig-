import { useEffect, useRef, type RefObject } from "react";
import {
  activateModalEnvironment,
  trapModalFocus,
} from "../modal-environment";

interface ModalDrawerOptions {
  active: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  backgroundRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

export function useModalDrawer({
  active,
  dialogRef,
  backgroundRef,
  triggerRef,
  onClose,
}: ModalDrawerOptions): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;

    const dialog = dialogRef.current;
    const background = backgroundRef.current;
    const restoreEnvironment = activateModalEnvironment({
      background,
      lockBodyScroll: true,
    });

    const frame = window.requestAnimationFrame(() => {
      const initialFocus = dialog?.querySelector<HTMLElement>(
        "[data-drawer-initial-focus]",
      );
      (initialFocus ?? dialog)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (dialog) {
        trapModalFocus(event, dialog, {
          visibility: "not-hidden",
          focusContainerWhenEmpty: true,
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      restoreEnvironment();
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [active, backgroundRef, dialogRef, triggerRef]);
}
