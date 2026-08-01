import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";

interface DialogProps {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  className?: string;
  eyebrow?: string;
  role?: "dialog" | "alertdialog";
}

const focusableSelector =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const openDialogStack: symbol[] = [];

export function Dialog({
  title,
  description,
  children,
  footer,
  onClose,
  className = "",
  eyebrow = "خطوة محمية",
  role = "dialog",
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const layerRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const stackIdRef = useRef(Symbol("dialog"));
  onCloseRef.current = onClose;

  useEffect(() => {
    const stackId = stackIdRef.current;
    openDialogStack.push(stackId);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const layer = layerRef.current;
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    const isolatedElements: Array<{
      element: HTMLElement;
      hadInert: boolean;
      ariaHidden: string | null;
    }> = [];

    document.body.style.overflow = "hidden";
    let modalBranch: HTMLElement | null = layer;
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

    const frame = window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (openDialogStack[openDialogStack.length - 1] !== stackId) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
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
      const stackIndex = openDialogStack.lastIndexOf(stackId);
      if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1);
      document.body.style.overflow = previousOverflow;
      isolatedElements.forEach(({ element, hadInert, ariaHidden }) => {
        if (!hadInert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      if (previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() => previouslyFocused.focus());
      }
    };
  }, []);

  return (
    <div ref={layerRef} className="modal-layer app-dialog-layer" onMouseDown={(event) => event.target === event.currentTarget && onCloseRef.current()}>
      <div
        ref={dialogRef}
        className={`app-dialog ${className}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
      >
        <header className="app-dialog__header">
          <div>
            <span className="eyebrow">{eyebrow}</span>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="إغلاق النافذة">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="app-dialog__body">{children}</div>
        {footer && <footer className="app-dialog__footer">{footer}</footer>}
      </div>
    </div>
  );
}
