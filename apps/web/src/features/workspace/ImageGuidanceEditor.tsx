import { useEffect, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import type { Layer } from "../../types";
import { RasterLayerPreview } from "./RasterLayerPreview";
import {
  createGuidancePromptTools,
  GuidanceHistoryActions,
  GuidanceReview,
  GuidanceToolButtons,
  ProcessingModeControl,
  useGuidanceReview,
  WorkflowStrip,
  type Point,
  type CorrectionMode,
  type ReadyWorkspaceToolId,
  type SharedEditorProps,
  type WorkspaceEditorCommand,
} from "./GuidanceEditorShared";
import {
  type GuidanceStroke,
  type ImagePrompt,
} from "./imageGuidanceGeometry";
import { ImageStrokeOverlay } from "./ImageStrokeOverlay";

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
    mode: CorrectionMode;
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
  onDraftDirtyChange?: (dirty: boolean) => void;
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
  onDraftDirtyChange,
}: ImageGuidanceEditorProps) {
  const [processingMode, setProcessingMode] = useState<CorrectionMode>("guided");
  const [prompt, setPrompt] = useState<ImagePrompt>("keep");
  const [brushSize, setBrushSize] = useState(16);
  const [strokes, setStrokes] = useState<GuidanceStroke[]>([]);
  const [keyboardPoint, setKeyboardPoint] = useState({ x: 50, y: 50 });
  const editableLayers = layers.filter((layer) => !layer.locked);
  const canEditSelectedLayer = editableLayers.some(
    (layer) => layer.id === selectedLayerId,
  );
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  useEffect(() => {
    onDraftDirtyChange?.(strokes.length > 0);
  }, [onDraftDirtyChange, strokes.length]);
  useEffect(
    () => () => onDraftDirtyChange?.(false),
    [onDraftDirtyChange],
  );
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

  const addKeyboardMarker = () => {
    if (!canEditSelectedLayer) return;
    const point = {
      x: keyboardPoint.x / 100,
      y: keyboardPoint.y / 100,
    };
    if (prompt === "erase") {
      eraseAt(point);
      return;
    }
    setStrokes((current) => [
      ...current,
      {
        id: `stroke-${crypto.randomUUID()}`,
        prompt,
        size: brushSize,
        points: [point],
      },
    ]);
    setReviewState("editing");
  };

  const refine = async () => {
    if (!canEditSelectedLayer) {
      onNotify("لا توجد طبقة Raster مفتوحة يمكن تطبيق الإرشاد عليها.");
      return;
    }
    if (strokes.length === 0) {
      onNotify("أضف إشارة واحدة على الأقل لتوجيه التحسين الموضعي.");
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
        <div className="image-artboard image-artboard--guided">
          <div className="artboard-grid" />
          {sourcePreviewUrl || layers.some((layer) => layer.previewUrl) ? (
            <RasterLayerPreview
              layers={layers}
              canvasWidth={canvasSize?.width ?? 1}
              canvasHeight={canvasSize?.height ?? 1}
              selectedLayerId={selectedLayerId}
              hiddenLayerIds={hiddenLayers}
              {...(sourcePreviewUrl ? { fallbackSourceUrl: sourcePreviewUrl } : {})}
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
            disabled={!canEditSelectedLayer}
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
        <p id="image-guidance-instruction" className="guidance-instruction">
          <Icon name="brush" size={14} />
          <span>
            <strong>ارسم فوق الطبقة الفعلية.</strong>{" "}
            قلم ملء/احتفظ يصلح الشفافية موضعيًا، والاستبعاد يمسح، والفصل ينشئ طبقة Raster ويملأ مكانها تلقائيًا للمراجعة.
          </span>
        </p>
        {preparation?.strategy === "single-source" && (
          <p className="warning-clear" role="status">
            <Icon name="info" size={13} />
            الصورة المعتمة محفوظة حاليًا كطبقة مصدر واحدة؛ الفصل الدلالي
            التلقائي غير مفعّل محليًا. استخدم «فصل» في الوضع الموجّه لإنشاء
            أجزاء قابلة للتحرير والمراجعة.
          </p>
        )}
        <div className="guidance-primary">
          <ProcessingModeControl
            value={processingMode}
            onChange={setProcessingMode}
          />
          <label className="guidance-target">
            <span><Icon name="target" size={13} /> الجزء المستهدف</span>
            <select
              value={canEditSelectedLayer ? selectedLayerId : ""}
              disabled={editableLayers.length === 0}
              onChange={(event) => onSelectedLayerChange(event.target.value)}
            >
              {editableLayers.length === 0 && <option value="">لا توجد طبقة مفتوحة</option>}
              {editableLayers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
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

        <form
          className="guidance-coordinate-entry"
          aria-label="إضافة إشارة إرشاد بالإحداثيات"
          onSubmit={(event) => {
            event.preventDefault();
            addKeyboardMarker();
          }}
        >
          <label>
            الموضع الأفقي %
            <input
              type="number"
              min="0"
              max="100"
              value={keyboardPoint.x}
              onChange={(event) => setKeyboardPoint((current) => ({
                ...current,
                x: Number(event.target.value),
              }))}
            />
          </label>
          <label>
            الموضع الرأسي %
            <input
              type="number"
              min="0"
              max="100"
              value={keyboardPoint.y}
              onChange={(event) => setKeyboardPoint((current) => ({
                ...current,
                y: Number(event.target.value),
              }))}
            />
          </label>
          <button type="submit" disabled={!canEditSelectedLayer}>
            إضافة إشارة
          </button>
        </form>

        <GuidanceReview
          applying={applying}
          actionIcon="spark"
          applyingLabel="جارٍ تطبيق القناع…"
          actionLabel="تطبيق وحفظ القناع"
          onApply={refine}
          disabled={!canEditSelectedLayer}
          {...(!canEditSelectedLayer
            ? {
                disabledReason:
                  "افتح طبقة Raster أو اختر طبقة غير مقفلة قبل التطبيق.",
              }
            : {})}
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
