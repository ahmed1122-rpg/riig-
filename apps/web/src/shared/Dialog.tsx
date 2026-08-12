import { useEffect, useId, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
import {
  activateModalEnvironment,
  modalFocusableSelector,
  trapModalFocus,
} from "./modal-environment";

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
    const restoreEnvironment = activateModalEnvironment({
      modalBranch: layer,
      lockBodyScroll: true,
    });

    const frame = window.requestAnimationFrame(() => {
      dialog?.querySelector<HTMLElement>(modalFocusableSelector)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (openDialogStack[openDialogStack.length - 1] !== stackId) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (dialog) trapModalFocus(event, dialog);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      const stackIndex = openDialogStack.lastIndexOf(stackId);
      if (stackIndex >= 0) openDialogStack.splice(stackIndex, 1);
      restoreEnvironment();
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
