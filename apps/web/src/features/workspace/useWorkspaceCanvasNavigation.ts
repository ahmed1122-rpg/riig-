import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { isEditableShortcutTarget } from "./workspaceToolRegistry";

interface PanPoint {
  x: number;
  y: number;
}

export function calculateWorkspaceFitZoom(
  viewport: { width: number; height: number },
  canvas: { width: number; height: number },
): number {
  if (viewport.width <= 0 || viewport.height <= 0 || canvas.width <= 0 || canvas.height <= 0) {
    return 100;
  }
  const padding = 32;
  const scale = Math.min(
    Math.max(1, viewport.width - padding) / canvas.width,
    Math.max(1, viewport.height - padding) / canvas.height,
  );
  return Math.max(25, Math.min(200, Math.floor((scale * 100) / 5) * 5));
}

export function useWorkspaceCanvasNavigation(
  onZoomChange: (zoom: number) => void,
  resetKey: string,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState<PanPoint>({ x: 0, y: 0 });
  const [spacePressed, setSpacePressed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragOrigin = useRef<{ pointer: PanPoint; pan: PanPoint } | undefined>(
    undefined,
  );

  const fitPreview = useCallback(() => {
    const container = containerRef.current;
    const canvas = container?.querySelector<HTMLElement>(
      ".image-artboard, .pdf-artboard",
    );
    if (!container || !canvas) return;
    onZoomChange(calculateWorkspaceFitZoom(
      { width: container.clientWidth, height: container.clientHeight },
      { width: canvas.offsetWidth, height: canvas.offsetHeight },
    ));
    setPan({ x: 0, y: 0 });
  }, [onZoomChange]);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) return;
      if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        event.preventDefault();
        fitPreview();
        return;
      }
      if (event.code === "Space" && !event.repeat) {
        event.preventDefault();
        setSpacePressed(true);
      }
    };
    const stopPanning = () => {
      dragOrigin.current = undefined;
      setSpacePressed(false);
      setDragging(false);
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") stopPanning();
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", stopPanning);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", stopPanning);
    };
  }, [fitPreview]);

  useEffect(() => {
    setPan({ x: 0, y: 0 });
  }, [resetKey]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!spacePressed || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragOrigin.current = {
      pointer: { x: event.clientX, y: event.clientY },
      pan,
    };
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const origin = dragOrigin.current;
    if (!origin) return;
    setPan({
      x: origin.pan.x + event.clientX - origin.pointer.x,
      y: origin.pan.y + event.clientY - origin.pointer.y,
    });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragOrigin.current) return;
    dragOrigin.current = undefined;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  };

  return {
    containerRef,
    fitPreview,
    navigationClassName: spacePressed
      ? dragging ? "is-canvas-panning" : "is-canvas-pannable"
      : "",
    navigationStyle: {
      "--preview-pan-x": `${pan.x}px`,
      "--preview-pan-y": `${pan.y}px`,
    } as CSSProperties,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
