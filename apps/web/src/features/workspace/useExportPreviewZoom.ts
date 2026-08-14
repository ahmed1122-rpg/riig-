import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";

const MIN_PREVIEW_ZOOM = 30;
const MAX_PREVIEW_ZOOM = 160;
const PREVIEW_FIT_GUTTER = 32;

export interface PreviewDimensions {
  width: number;
  height: number;
}

export function calculatePreviewFitZoom(
  stage: PreviewDimensions,
  preview: PreviewDimensions,
): number | undefined {
  if (
    stage.width <= PREVIEW_FIT_GUTTER ||
    stage.height <= PREVIEW_FIT_GUTTER ||
    preview.width <= 0 ||
    preview.height <= 0
  ) {
    return undefined;
  }
  const scale = Math.min(
    (stage.width - PREVIEW_FIT_GUTTER) / preview.width,
    (stage.height - PREVIEW_FIT_GUTTER) / preview.height,
  );
  return clampPreviewZoom(Math.round(scale * 100));
}

export function useExportPreviewZoom(): {
  zoom: number;
  fitActive: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  scaleRef: RefObject<HTMLDivElement | null>;
  setZoom: Dispatch<SetStateAction<number>>;
  fitPreview: () => void;
} {
  const stageRef = useRef<HTMLDivElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const [zoomState, setZoomState] = useState(100);
  const zoom = Math.abs(zoomState);
  const fitActive = zoomState > 0;

  const measureFit = useCallback(() => {
    const stage = stageRef.current;
    const scaleContainer = scaleRef.current;
    if (!stage || !scaleContainer) return;
    const preview = (scaleContainer.firstElementChild ??
      scaleContainer) as HTMLElement;
    const nextZoom = calculatePreviewFitZoom(
      { width: stage.clientWidth, height: stage.clientHeight },
      {
        width: preview.offsetWidth,
        height: preview.offsetHeight,
      },
    );
    if (nextZoom !== undefined) setZoomState(nextZoom);
  }, []);

  const fitPreview = () => {
    setZoomState((current) => Math.abs(current));
    measureFit();
  };

  const setZoom: Dispatch<SetStateAction<number>> = (next) => {
    setZoomState((current) =>
      -clampPreviewZoom(
        typeof next === "function" ? next(Math.abs(current)) : next,
      ),
    );
  };

  useEffect(() => {
    if (fitActive) measureFit();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (fitActive) measureFit();
    });
    for (const target of [stageRef.current, scaleRef.current]) {
      if (target) observer.observe(target);
    }
    return () => observer.disconnect();
  }, [fitActive, measureFit]);

  return { zoom, fitActive, stageRef, scaleRef, setZoom, fitPreview };
}

function clampPreviewZoom(value: number): number {
  return Math.max(MIN_PREVIEW_ZOOM, Math.min(MAX_PREVIEW_ZOOM, value));
}
