import { useEffect, useRef, type RefObject } from "react";

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
    const isolatedElements: Array<{
      element: HTMLElement;
      hadInert: boolean;
      ariaHidden: string | null;
    }> = [];

    let modalBranch: HTMLElement | null = backdrop;
    while (modalBranch?.parentElement) {
      const parent = modalBranch.parentElement;
      Array.from(parent.children).forEach((child) => {
        if (child === modalBranch || !(child instanceof HTMLElement)) return;
        isolatedElements.push({
          element: child,
          hadInert: child.hasAttribute("inert"),
          ariaHidden: child.getAttribute("aria-hidden"),
        });
        child.setAttribute("inert", "");
        child.setAttribute("aria-hidden", "true");
      });
      if (parent === document.body) break;
      modalBranch = parent;
    }

    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isWorkingRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0 && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      isolatedElements.forEach(({ element, hadInert, ariaHidden }) => {
        if (!hadInert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      window.requestAnimationFrame(() => restoreFocusTo?.focus());
    };
  }, [backdropRef, closeButtonRef, dialogRef, returnFocusTo]);
}
