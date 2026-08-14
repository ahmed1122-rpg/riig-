import type {
  KeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";

export type LayerDockTab = "layers" | "checks";

export function startLayerDockResize(
  event: ReactPointerEvent<HTMLButtonElement>,
  width: number,
  onWidthChange: (value: number) => void,
) {
  event.preventDefault();
  event.currentTarget.setPointerCapture(event.pointerId);
  const startX = event.clientX;
  let frame: number | null = null;
  let nextWidth = width;
  const handleMove = (moveEvent: PointerEvent) => {
    nextWidth = Math.max(
      260,
      Math.min(430, width + startX - moveEvent.clientX),
    );
    if (frame === null) {
      frame = window.requestAnimationFrame(() => {
        onWidthChange(nextWidth);
        frame = null;
      });
    }
  };
  const handleEnd = () => {
    if (frame !== null) window.cancelAnimationFrame(frame);
    onWidthChange(nextWidth);
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleEnd);
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleEnd, { once: true });
}

export function handleLayerDockTabKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  tab: LayerDockTab,
  onTabChange: (tab: LayerDockTab) => void,
) {
  const tabs = ["layers", "checks"] as const;
  const currentIndex = tabs.indexOf(tab);
  let nextIndex: number | undefined;
  if (event.key === "ArrowLeft") nextIndex = (currentIndex + 1) % tabs.length;
  if (event.key === "ArrowRight") {
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  }
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.length - 1;
  if (nextIndex === undefined) return;
  event.preventDefault();
  const nextTab = tabs[nextIndex];
  if (!nextTab) return;
  onTabChange(nextTab);
  const tabButtons = event.currentTarget.parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  tabButtons?.[nextIndex]?.focus();
}
