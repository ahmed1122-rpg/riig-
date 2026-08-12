export const modalFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

interface ModalEnvironmentOptions {
  modalBranch?: HTMLElement | null;
  background?: HTMLElement | null;
  lockBodyScroll?: boolean;
}

interface IsolatedElement {
  element: HTMLElement;
  hadInert: boolean;
  ariaHidden: string | null;
}

export function activateModalEnvironment({
  modalBranch,
  background,
  lockBodyScroll = false,
}: ModalEnvironmentOptions): () => void {
  const isolatedElements: IsolatedElement[] = [];
  const previousOverflow = document.body.style.overflow;
  if (lockBodyScroll) document.body.style.overflow = "hidden";

  if (background) isolate(background, isolatedElements);
  let branch = modalBranch ?? null;
  while (branch?.parentElement) {
    const parent = branch.parentElement;
    Array.from(parent.children).forEach((child) => {
      if (child === branch || !(child instanceof HTMLElement)) return;
      isolate(child, isolatedElements);
    });
    if (parent === document.body) break;
    branch = parent;
  }

  return () => {
    if (lockBodyScroll) document.body.style.overflow = previousOverflow;
    isolatedElements.forEach(({ element, hadInert, ariaHidden }) => {
      if (!hadInert) element.removeAttribute("inert");
      if (ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", ariaHidden);
    });
  };
}

export function trapModalFocus(
  event: KeyboardEvent,
  dialog: HTMLElement,
  options: {
    visibility?: "all" | "not-hidden" | "rendered";
    recoverOutside?: boolean;
    focusContainerWhenEmpty?: boolean;
  } = {},
): void {
  if (event.key !== "Tab") return;
  const visibility = options.visibility ?? "all";
  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(modalFocusableSelector),
  ).filter((element) => {
    if (visibility === "not-hidden") return !element.hasAttribute("hidden");
    if (visibility === "rendered") {
      return (
        element.getClientRects().length > 0 &&
        element.getAttribute("aria-hidden") !== "true"
      );
    }
    return true;
  });
  if (focusable.length === 0) {
    if (options.focusContainerWhenEmpty) {
      event.preventDefault();
      dialog.focus();
    }
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  if (options.recoverOutside && !dialog.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

function isolate(element: HTMLElement, records: IsolatedElement[]): void {
  records.push({
    element,
    hadInert: element.hasAttribute("inert"),
    ariaHidden: element.getAttribute("aria-hidden"),
  });
  element.setAttribute("inert", "");
  element.setAttribute("aria-hidden", "true");
}
