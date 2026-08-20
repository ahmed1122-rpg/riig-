import { useCallback, useEffect, useRef, useState } from "react";
import { normalizedPoint, type Point } from "./GuidanceEditorShared";
import {
  imageStrokePath,
  type GuidanceStroke,
  type ImagePrompt,
} from "./imageGuidanceGeometry";

const promptColors: Record<Exclude<ImagePrompt, "erase">, string> = {
  keep: "#34d399",
  exclude: "#fb7185",
  separate: "#38bdf8",
};

export function ImageStrokeOverlay({
  strokes,
  activePrompt,
  brushSize,
  onCommit,
  onErase,
  showRefinement,
  disabled,
}: {
  strokes: GuidanceStroke[];
  activePrompt: ImagePrompt;
  brushSize: number;
  onCommit: (stroke: GuidanceStroke) => void;
  onErase: (point: Point) => void;
  showRefinement: boolean;
  disabled: boolean;
}) {
  const currentRef = useRef<GuidanceStroke | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingPointRef = useRef<Point | null>(null);
  const [, forceRender] = useState(0);

  const appendPendingPoint = useCallback(() => {
    frameRef.current = null;
    const pending = pendingPointRef.current;
    const current = currentRef.current;
    if (!pending || !current) return;
    const last = current.points[current.points.length - 1];
    if (!last) {
      currentRef.current = { ...current, points: [pending] };
      forceRender((value) => value + 1);
      return;
    }
    if (Math.hypot(pending.x - last.x, pending.y - last.y) < .006) return;
    currentRef.current = { ...current, points: [...current.points, pending] };
    forceRender((value) => value + 1);
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const pointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (disabled) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = normalizedPoint(event);
    if (activePrompt === "erase") {
      onErase(point);
      return;
    }
    currentRef.current = {
      id: `stroke-${crypto.randomUUID()}`,
      prompt: activePrompt,
      size: brushSize,
      points: [point],
    };
    forceRender((value) => value + 1);
  };

  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!currentRef.current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    pendingPointRef.current = normalizedPoint(event);
    if (frameRef.current === null) frameRef.current = requestAnimationFrame(appendPendingPoint);
  };

  const finishStroke = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!currentRef.current) return;
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      appendPendingPoint();
    }
    const current = currentRef.current;
    currentRef.current = null;
    forceRender((value) => value + 1);
    if (current.points.length > 0) onCommit(current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const currentStroke = currentRef.current;
  return (
    <svg
      className="guidance-overlay"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      role="region"
      aria-disabled={disabled}
      aria-label="لوحة إرشاد الصورة. ارسم خطوطًا قليلة داخل الجزء وحوله، ثم حسّن المنطقة."
      aria-describedby="image-guidance-instruction"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finishStroke}
      onPointerCancel={finishStroke}
    >
      {showRefinement && (
        <>
          <path
            className="refined-region"
            d="M 587 425 C 652 444 698 512 702 595 C 707 687 664 765 607 790 C 570 720 560 636 563 552 C 566 499 574 456 587 425 Z"
          />
          <path className="refined-edge" d="M 590 428 C 654 452 695 517 696 599 C 698 683 663 748 610 783" />
        </>
      )}
      {[...strokes, ...(currentStroke ? [currentStroke] : [])].map((stroke) => (
        <path
          key={stroke.id}
          className={`guidance-stroke guidance-stroke--${stroke.prompt}`}
          d={imageStrokePath(stroke.points)}
          stroke={promptColors[stroke.prompt]}
          strokeWidth={stroke.size * 2.2}
        />
      ))}
    </svg>
  );
}
