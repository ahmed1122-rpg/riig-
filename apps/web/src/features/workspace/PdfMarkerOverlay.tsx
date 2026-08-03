import { useEffect, useRef, useState } from "react";
import { normalizedPoint, type Point } from "./GuidanceEditorShared";

export type MarkerLabel = "heading" | "line" | "topic" | "exclude";

export interface PdfRegion {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: MarkerLabel;
  order: number;
}

const markerColors: Record<MarkerLabel, string> = {
  heading: "#f4c84a",
  line: "#9b7ee8",
  topic: "#45c5d6",
  exclude: "#8f99a6",
};

const markerShortLabels: Record<MarkerLabel, string> = {
  heading: "عنوان",
  line: "سطر",
  topic: "موضوع",
  exclude: "استثناء",
};

function normalizeRect(start: Point, end: Point) {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function PdfMarkerOverlay({
  regions,
  selectedId,
  activeLabel,
  onCreate,
  onSelect,
}: {
  regions: PdfRegion[];
  selectedId: string;
  activeLabel: MarkerLabel;
  onCreate: (region: Omit<PdfRegion, "id" | "order">) => void;
  onSelect: (id: string) => void;
}) {
  const startRef = useRef<Point | null>(null);
  const currentRef = useRef<Point | null>(null);
  const frameRef = useRef<number | null>(null);
  const [, forceRender] = useState(0);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const pointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest("[data-region]")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = normalizedPoint(event);
    startRef.current = point;
    currentRef.current = point;
    forceRender((value) => value + 1);
  };

  const pointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (
      !startRef.current ||
      !event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      return;
    }
    currentRef.current = normalizedPoint(event);
    if (frameRef.current === null) {
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        forceRender((value) => value + 1);
      });
    }
  };

  const pointerUp = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!startRef.current || !currentRef.current) return;
    const rect = normalizeRect(startRef.current, currentRef.current);
    startRef.current = null;
    currentRef.current = null;
    forceRender((value) => value + 1);
    if (rect.width > 0.025 && rect.height > 0.018) {
      onCreate({ ...rect, label: activeLabel });
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const drawingRect =
    startRef.current && currentRef.current
      ? normalizeRect(startRef.current, currentRef.current)
      : null;

  return (
    <svg
      className="pdf-marker-overlay"
      viewBox="0 0 1000 1000"
      preserveAspectRatio="none"
      role="application"
      tabIndex={0}
      aria-label="صفحة PDF قابلة للتحديد. اسحب مستطيلًا فوق عنوان أو سطر أو فقرة."
      aria-describedby="pdf-guidance-instruction"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerUp}
    >
      {regions.map((region) => (
        <g
          key={region.id}
          data-region="true"
          className={selectedId === region.id ? "is-selected" : ""}
          onPointerDown={(event) => {
            event.stopPropagation();
            onSelect(region.id);
          }}
        >
          <rect
            x={region.x * 1000}
            y={region.y * 1000}
            width={region.width * 1000}
            height={region.height * 1000}
            fill={markerColors[region.label]}
            stroke={markerColors[region.label]}
          />
          <g className="region-label" pointerEvents="none">
            <rect
              className="region-label-box"
              x={region.x * 1000 + 12}
              y={region.y * 1000 + 10}
              width={region.label === "exclude" ? 102 : 86}
              height="31"
              rx="7"
            />
            <text
              className="region-label-text"
              x={region.x * 1000 + 23}
              y={region.y * 1000 + 32}
            >
              {markerShortLabels[region.label]}
            </text>
          </g>
          {region.label !== "exclude" && (
            <g className="reading-order">
              <circle
                cx={(region.x + region.width) * 1000 - 10}
                cy={region.y * 1000 + 10}
                r="22"
              />
              <text
                x={(region.x + region.width) * 1000 - 10}
                y={region.y * 1000 + 17}
                textAnchor="middle"
              >
                {region.order}
              </text>
            </g>
          )}
          {selectedId === region.id && (
            <>
              <circle
                className="resize-handle"
                cx={region.x * 1000}
                cy={region.y * 1000}
                r="8"
              />
              <circle
                className="resize-handle"
                cx={(region.x + region.width) * 1000}
                cy={(region.y + region.height) * 1000}
                r="8"
              />
            </>
          )}
        </g>
      ))}
      {drawingRect && (
        <rect
          className="drawing-region"
          x={drawingRect.x * 1000}
          y={drawingRect.y * 1000}
          width={drawingRect.width * 1000}
          height={drawingRect.height * 1000}
          fill={markerColors[activeLabel]}
          stroke={markerColors[activeLabel]}
        />
      )}
    </svg>
  );
}
