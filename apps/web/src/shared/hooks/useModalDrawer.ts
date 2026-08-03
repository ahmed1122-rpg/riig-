import { useEffect, useRef, type RefObject } from "react";

interface ModalDrawerOptions {
  active: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  backgroundRef: RefObject<HTMLElement | null>;
  triggerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

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
    const previousOverflow = document.body.style.overflow;
    const previousAriaHidden = background?.getAttribute("aria-hidden") ?? null;
    const backgroundHadInert = background?.hasAttribute("inert") ?? false;

    document.body.style.overflow = "hidden";
    background?.setAttribute("inert", "");
    background?.setAttribute("aria-hidden", "true");

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
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hasAttribute("hidden"));

      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (!backgroundHadInert) background?.removeAttribute("inert");
      if (previousAriaHidden === null) background?.removeAttribute("aria-hidden");
      else background?.setAttribute("aria-hidden", previousAriaHidden);
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    };
  }, [active, backgroundRef, dialogRef, triggerRef]);
}
