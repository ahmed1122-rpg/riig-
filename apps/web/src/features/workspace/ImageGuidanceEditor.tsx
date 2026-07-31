import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";
import { RasterLayerPreview } from "./RasterLayerPreview";
import {
  type ReadyWorkspaceToolId,
  type WorkspaceEditorCommand,
} from "./workspaceToolRegistry";
import {
  createGuidancePromptTools,
  GuidanceHistoryActions,
  GuidanceReview,
  GuidanceToolButtons,
  normalizedPoint,
  ProcessingModeControl,
  useGuidanceReview,
  WorkflowStrip,
  type Point,
  type ProcessingMode,
  type SharedEditorProps,
} from "./GuidanceEditorShared";

type ImagePrompt = "keep" | "exclude" | "separate" | "erase";

interface GuidanceStroke {
  id: string;
  prompt: Exclude<ImagePrompt, "erase">;
  size: number;
  points: Point[];
}

interface ImageGuidanceEditorProps extends SharedEditorProps {
  layers: Layer[];
  hiddenLayers: string[];
  selectedLayerId: string;
  onSelectedLayerChange: (id: string) => void;
  sourcePreviewUrl?: string;
  canvasSize?: {
    width: number;
    height: number;
  };
  guidanceRevision?: number;
  onApply: (input: {
    mode: ProcessingMode;
    strokes: GuidanceStroke[];
  }) => Promise<{ revision: number; warnings: string[] }>;
  preparation?: {
    strategy: "alpha-components" | "single-source";
    detectedComponents: number;
    outputLayers: number;
    overflowMerged: boolean;
    fallbackReason?:
      | "opaque-source"
      | "single-component"
      | "pixel-budget"
      | "bounds-budget";
  };
  toolCommand?: WorkspaceEditorCommand;
  onToolSelect?: (toolId: ReadyWorkspaceToolId) => void;
  onHistoryNavigate: (direction: "undo" | "redo") => Promise<void>;
}

const imagePromptTools = [
  ["image.keep", "keep"],
  ["image.exclude", "exclude"],
  ["image.separate", "separate"],
  ["image.erase", "erase"],
] as const;

const imagePrompts = createGuidancePromptTools(
  imagePromptTools,
  "#cbd5e1",
);
const promptColors: Record<Exclude<ImagePrompt, "erase">, string> = {
  keep: "#34d399",
  exclude: "#fb7185",
  separate: "#38bdf8",
};

function strokePath(points: Point[]) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x * 1000} ${point.y * 1000}`).join(" ");
}

function ImageStrokeOverlay({
  strokes,
  activePrompt,
  brushSize,
  onCommit,
  onErase,
  showRefinement,
}: {
  strokes: GuidanceStroke[];
  activePrompt: ImagePrompt;
  brushSize: number;
  onCommit: (stroke: GuidanceStroke) => void;
  onErase: (point: Point) => void;
  showRefinement: boolean;
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
    if (Math.hypot(pending.x - last.x, pending.y - last.y) < .006) return;
    currentRef.current = { ...current, points: [...current.points, pending] };
    forceRender((value) => value + 1);
  }, []);

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
  }, []);

  const pointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = normalizedPoint(event);
    if (activePrompt === "erase") {
      onErase(point);
      return;
    }
    currentRef.current = {
      id: `stroke-${Date.now()}`,
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
      role="application"
      tabIndex={0}
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
          d={strokePath(stroke.points)}
          stroke={promptColors[stroke.prompt]}
          strokeWidth={stroke.size * 2.2}
        />
      ))}
    </svg>
  );
}

export function ImageGuidanceEditor({
  layers,
  hiddenLayers,
  selectedLayerId,
  onSelectedLayerChange,
  onNotify,
  sourcePreviewUrl,
  canvasSize,
  guidanceRevision = 0,
  onApply,
  preparation,
  toolCommand,
  onToolSelect,
  onHistoryNavigate,
}: ImageGuidanceEditorProps) {
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("guided");
  const [prompt, setPrompt] = useState<ImagePrompt>("keep");
  const [brushSize, setBrushSize] = useState(16);
  const [strokes, setStrokes] = useState<GuidanceStroke[]>([]);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const historyNavigateRef = useRef(onHistoryNavigate);
  historyNavigateRef.current = onHistoryNavigate;
  const {
    reviewState,
    setReviewState,
    version,
    setVersion,
    applying,
    setApplying,
    applyWarnings,
    setApplyWarnings,
  } = useGuidanceReview(guidanceRevision);

  const eraseAt = (point: Point) => {
    setStrokes((current) => {
      const hitIndex = current.findIndex((stroke) =>
        stroke.points.some((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) < .055),
      );
      return hitIndex < 0 ? current : current.filter((_, index) => index !== hitIndex);
    });
    setReviewState("editing");
  };

  const refine = async () => {
    if (strokes.length === 0 && processingMode !== "automatic") {
      onNotify("أضف إشارة واحدة على الأقل لتوجيه التحسين الموضعي.");
      return;
    }
    if (processingMode === "automatic") {
      onNotify("المعالجة التلقائية طُبقت عند الرفع. ارسم إشارة للتصحيح الموضعي.");
      return;
    }
    setApplying(true);
    try {
      const result = await onApply({ mode: processingMode, strokes });
      setVersion(result.revision);
      setApplyWarnings(result.warnings);
      setStrokes([]);
      setReviewState("refined");
      onNotify(
        result.warnings.length > 0
          ? "تم تطبيق القناع وحفظ المراجعة مع ملاحظات غير مانعة."
          : "تم تطبيق القناع على أصل Raster وحفظ مراجعة جديدة.",
      );
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : "تعذر تطبيق التحديد اليدوي.",
      );
    } finally {
      setApplying(false);
    }
  };

  useEffect(() => {
    if (!toolCommand) return;
    const promptByTool: Partial<Record<ReadyWorkspaceToolId, ImagePrompt>> = {
      "image.keep": "keep",
      "image.exclude": "exclude",
      "image.separate": "separate",
      "image.erase": "erase",
    };
    const nextPrompt = promptByTool[toolCommand.id];
    if (nextPrompt) {
      setPrompt(nextPrompt);
      return;
    }
    if (toolCommand.id === "image.undo") {
      if (strokesRef.current.length > 0) {
        setStrokes((current) => current.slice(0, -1));
        setReviewState("editing");
      } else {
        void historyNavigateRef.current("undo");
      }
    }
    if (toolCommand.id === "image.redo") {
      void historyNavigateRef.current("redo");
    }
  }, [toolCommand]);

  return (
    <>
      <div className="stage guidance-stage">
        <p id="image-guidance-instruction" className="guidance-instruction">
          <Icon name="brush" size={14} />
          <span>
            <strong>ارسم فوق الطبقة الفعلية.</strong>{" "}
            قلم ملء/احتفظ يصلح الشفافية موضعيًا، والاستبعاد يمسح، والفصل ينشئ طبقة Raster ويملأ مكانها تلقائيًا للمراجعة.
          </span>
        </p>
        <div className="image-artboard image-artboard--guided">
          <div className="artboard-grid" />
          {sourcePreviewUrl || layers.some((layer) => layer.previewUrl) ? (
            <RasterLayerPreview
              layers={layers}
              canvasWidth={canvasSize?.width ?? 1}
              canvasHeight={canvasSize?.height ?? 1}
              selectedLayerId={selectedLayerId}
              hiddenLayerIds={hiddenLayers}
              fallbackSourceUrl={sourcePreviewUrl}
              label="معاينة طبقات الصورة الفعلية"
            />
          ) : (
            <div className="preview-unavailable" role="status">
              <Icon name="warning" size={18} />
              تعذر تحميل معاينة Raster لهذه الطبقة.
            </div>
          )}
          <ImageStrokeOverlay
            strokes={strokes}
            activePrompt={prompt}
            brushSize={brushSize}
            onCommit={(stroke) => {
              setStrokes((current) => [...current, stroke]);
              setReviewState("editing");
            }}
            onErase={eraseAt}
            showRefinement={false}
          />
          <span className="canvas-label">
            <i /> {`${layers.find((layer) => layer.id === selectedLayerId)?.name ?? "اختر طبقة"} · ${
              preparation?.strategy === "alpha-components"
                ? `${preparation.outputLayers} طبقات مصدر`
                : "Raster أصلية"
            }`}
          </span>
          <div className="overlay-legend" aria-label="دليل ألوان الإرشاد">
            {imagePrompts.slice(0, 3).map((item) => <span key={item.id}><i style={{ "--guide-color": item.color } as React.CSSProperties} />{item.label}</span>)}
          </div>
        </div>
      </div>

      <section className="guidance-context image-guidance-context" aria-label="أدوات إرشاد تقطيع الصورة">
        <div className="guidance-primary">
          <ProcessingModeControl
            value={processingMode}
            onChange={setProcessingMode}
          />
          <label className="guidance-target">
            <span><Icon name="target" size={13} /> الجزء المستهدف</span>
            <select value={selectedLayerId} onChange={(event) => onSelectedLayerChange(event.target.value)}>
              {layers.filter((layer) => !layer.locked).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
            </select>
          </label>
        </div>

        <div className="guidance-tools" role="toolbar" aria-label="أقلام إرشاد الصورة">
          <GuidanceToolButtons
            tools={imagePrompts}
            activeId={prompt}
            onSelect={(item) => {
              setPrompt(item.id);
              onToolSelect?.(item.toolId);
            }}
          />
          <label className="brush-size">
            <span>حجم القلم <b>{brushSize}</b></span>
            <input type="range" min="8" max="30" step="2" value={brushSize} onChange={(event) => setBrushSize(Number(event.target.value))} />
          </label>
          <GuidanceHistoryActions
            canUndo={strokes.length > 0}
            onUndo={() => {
              setStrokes((current) => current.slice(0, -1));
              setReviewState("editing");
            }}
            onClear={() => {
              setStrokes([]);
              setReviewState("editing");
            }}
          />
        </div>

        <GuidanceReview
          applying={applying}
          actionIcon="spark"
          applyingLabel="جارٍ تطبيق القناع…"
          actionLabel="تطبيق وحفظ القناع"
          onApply={refine}
          reviewState={reviewState}
          version={version}
          summaryTitle="تم حفظ مراجعة Raster جديدة"
          summaryDetail={
            <>وثيقة الطبقات v{version} · التصدير سيقرأ هذه النسخة</>
          }
          warnings={
            applyWarnings.length > 0 ? (
              <span className="warning-clear">
                <Icon name="info" size={12} />{" "}
                {applyWarnings.some((warning) =>
                  warning.includes(
                    "separate_background_fill_requires_review",
                  ),
                )
                  ? "مُلئ موضع الجزء المفصول تلقائيًا؛ راجع الخلفية قبل التصدير"
                  : `${applyWarnings.length} ملاحظة غير مانعة`}
              </span>
            ) : null
          }
          onAccept={() => {
            setReviewState("accepted");
            onNotify(
              "تم اعتماد المراجعة المحفوظة ويمكنك فتح فحص التصدير.",
            );
          }}
          acceptedLabel={<>تم اعتماد v{version} · جاهزة للمراجعة</>}
        />
        <WorkflowStrip current={reviewState} />
      </section>
    </>
  );
}

