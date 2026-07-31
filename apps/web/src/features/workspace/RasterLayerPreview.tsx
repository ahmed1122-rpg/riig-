import type { Layer } from "../../types";

interface RasterLayerPreviewProps {
  layers: readonly Layer[];
  canvasWidth: number;
  canvasHeight: number;
  selectedLayerId: string;
  hiddenLayerIds?: readonly string[];
  fallbackSourceUrl?: string;
  className?: string;
  label: string;
}

export function RasterLayerPreview({
  layers,
  canvasWidth,
  canvasHeight,
  selectedLayerId,
  hiddenLayerIds = [],
  fallbackSourceUrl,
  className = "",
  label,
}: RasterLayerPreviewProps) {
  const renderable = layers
    .filter(
      (layer) =>
        layer.visible &&
        !hiddenLayerIds.includes(layer.id) &&
        layer.previewUrl,
    )
    .slice()
    .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0));

  if (
    renderable.length > 0 &&
    Number.isFinite(canvasWidth) &&
    Number.isFinite(canvasHeight) &&
    canvasWidth > 0 &&
    canvasHeight > 0
  ) {
    return (
      <svg
        className={`raster-layer-preview ${className}`.trim()}
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={label}
      >
        {renderable.map((layer) => {
          const bounds = layer.bounds ?? {
            x: 0,
            y: 0,
            width: canvasWidth,
            height: canvasHeight,
          };
          return (
            <g key={layer.id} opacity={layer.opacity / 100}>
              <image
                href={layer.previewUrl}
                x={bounds.x}
                y={bounds.y}
                width={bounds.width}
                height={bounds.height}
                preserveAspectRatio="none"
              />
              {layer.id === selectedLayerId && (
                <rect
                  className="raster-layer-selection"
                  x={bounds.x}
                  y={bounds.y}
                  width={bounds.width}
                  height={bounds.height}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  const sourceLayer = layers[0];
  return fallbackSourceUrl &&
    sourceLayer?.visible !== false &&
    !hiddenLayerIds.includes(sourceLayer?.id ?? "") ? (
    <img
      className={`raster-source-fallback ${className}`.trim()}
      src={fallbackSourceUrl}
      alt={label}
      style={{ opacity: (sourceLayer?.opacity ?? 100) / 100 }}
    />
  ) : null;
}
