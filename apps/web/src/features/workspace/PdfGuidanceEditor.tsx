import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import type { Layer, PdfSegmentation } from "../../types";
import { pdfSegmentationLabels } from "./pdfSegmentation";
import {
  createGuidancePromptTools,
  GuidanceHistoryActions,
  GuidanceReview,
  GuidanceToolButtons,
  ProcessingModeControl,
  useGuidanceReview,
  WorkflowStrip,
  type ProcessingMode,
  type ReadyWorkspaceToolId,
  type SharedEditorProps,
  type WorkspaceEditorCommand,
} from "./GuidanceEditorShared";
import {
  PdfMarkerOverlay,
  type MarkerLabel,
  type PdfRegion,
} from "./PdfMarkerOverlay";

interface PdfGuidanceEditorProps extends SharedEditorProps {
  segmentation: PdfSegmentation;
  layers: Layer[];
  pageNumber?: number;
  pageCount?: number;
  pageSize?: {
    width: number;
    height: number;
  };
  onPageChange?: (pageNumber: number) => void;
  onSegmentationChange: (
    value: PdfSegmentation,
  ) => void | Promise<void>;
  segmentationBusy?: boolean;
  guidanceRevision?: number;
  onApply: (input: {
    mode: ProcessingMode;
    regions: PdfRegion[];
  }) => Promise<{ revision: number; warnings: string[] }>;
  toolCommand?: WorkspaceEditorCommand;
  onToolSelect?: (toolId: ReadyWorkspaceToolId) => void;
  onHistoryNavigate: (direction: "undo" | "redo") => Promise<void>;
  onConfirmDiscardRegions?: (message: string) => Promise<boolean>;
}

const pdfPromptTools = [
  ["pdf.heading", "heading"],
  ["pdf.line", "line"],
  ["pdf.topic", "topic"],
  ["pdf.exclude", "exclude"],
] as const;

const markerLabels = createGuidancePromptTools(
  pdfPromptTools,
  "#8f99a6",
);

function positionedTextStyle(
  layer: Layer,
  pageSize: { width: number; height: number },
): React.CSSProperties {
  const bounds = layer.bounds;
  if (!bounds) return {};
  return {
    insetInlineStart: `${(bounds.x / pageSize.width) * 100}%`,
    top: `${(bounds.y / pageSize.height) * 100}%`,
    width: `${(bounds.width / pageSize.width) * 100}%`,
    minHeight: `${(bounds.height / pageSize.height) * 100}%`,
    fontSize: `${Math.max(
      6,
      Math.min(22, ((layer.fontSize ?? 12) / pageSize.width) * 410),
    )}px`,
  };
}

export function PdfGuidanceEditor({
  segmentation,
  layers,
  pageNumber = 1,
  pageCount = 1,
  pageSize,
  onPageChange,
  onSegmentationChange,
  segmentationBusy = false,
  onNotify,
  guidanceRevision = 0,
  onApply,
  toolCommand,
  onToolSelect,
  onHistoryNavigate,
  onConfirmDiscardRegions,
}: PdfGuidanceEditorProps) {
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("guided");
  const [activeLabel, setActiveLabel] = useState<MarkerLabel>("line");
  const [regions, setRegions] = useState<PdfRegion[]>([]);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const historyNavigateRef = useRef(onHistoryNavigate);
  historyNavigateRef.current = onHistoryNavigate;
  const [selectedId, setSelectedId] = useState("");
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
  const extractedTextLayers = useMemo(
    () =>
      layers
        .filter(
          (layer) =>
            layer.kind === "text" &&
            layer.pageNumber === pageNumber &&
            layer.bounds &&
            layer.fullContent,
        )
        .sort(
          (left, right) =>
            (left.readingOrder ?? Number.MAX_SAFE_INTEGER) -
            (right.readingOrder ?? Number.MAX_SAFE_INTEGER),
        ),
    [layers, pageNumber],
  );
  const hasExtractedPage = Boolean(pageSize && extractedTextLayers.length > 0);
  const names = useMemo(
    () => extractedTextLayers.slice(0, 3).map((layer) => layer.name),
    [extractedTextLayers],
  );
  const backgroundName =
    layers.find(
      (layer) => layer.kind === "page" && layer.pageNumber === pageNumber,
    )?.name ??
    `+page_${String(pageNumber).padStart(3, "0")}_background`;
  const selectedRegion = regions.find((region) => region.id === selectedId);

  const undo = useCallback(() => {
    if (regionsRef.current.length > 0) {
      setRegions((current) => current.slice(0, -1));
      setReviewState("editing");
      return;
    }
    void historyNavigateRef.current("undo");
  }, [setReviewState]);

  useEffect(() => {
    if (!toolCommand) return;
    const labelByTool: Partial<Record<ReadyWorkspaceToolId, MarkerLabel>> = {
      "pdf.heading": "heading",
      "pdf.line": "line",
      "pdf.topic": "topic",
      "pdf.exclude": "exclude",
    };
    const nextLabel = labelByTool[toolCommand.id];
    if (nextLabel) {
      setActiveLabel(nextLabel);
      return;
    }
    if (toolCommand.id === "pdf.undo") undo();
    if (toolCommand.id === "pdf.redo") {
      void historyNavigateRef.current("redo");
    }
  }, [toolCommand, undo]);

  const rerun = async () => {
    if (regions.length === 0 && processingMode !== "automatic") {
      onNotify("حدّد منطقة واحدة على الأقل داخل الصفحة.");
      return;
    }
    if (processingMode === "automatic") {
      onNotify("المعالجة التلقائية طُبقت عند الرفع. حدّد منطقة للتصحيح الموضعي.");
      return;
    }
    setApplying(true);
    try {
      const result = await onApply({ mode: processingMode, regions });
      setVersion(result.revision);
      setApplyWarnings(result.warnings);
      setRegions([]);
      setSelectedId("");
      setReviewState("refined");
      onNotify(
        result.warnings.length > 0
          ? "تم حفظ مناطق PDF مع ملاحظات غير مانعة."
          : "تم تنظيم طبقات النص داخل المناطق المحددة وحفظ ترتيب القراءة.",
      );
    } catch (error) {
      onNotify(
        error instanceof Error
          ? error.message
          : "تعذر تطبيق مناطق PDF.",
      );
    } finally {
      setApplying(false);
    }
  };

  const changePage = async (nextPage: number) => {
    if (regions.length > 0) {
      const confirmed = await onConfirmDiscardRegions?.(
        "لم تُطبّق المناطق الحالية. سيؤدي الانتقال إلى تجاهلها.",
      );
      if (!confirmed) return;
    }
    onPageChange?.(nextPage);
  };

  return (
    <>
      <div className="stage guidance-stage">
        <p id="pdf-guidance-instruction" className="guidance-instruction pdf-instruction">
          <Icon name="highlighter" size={14} />
          <span><strong>اسحب فوق النص فقط.</strong> اختر دلالة المنطقة وسيُعاد تحليلها دون بقية الصفحة.</span>
        </p>
        <div className="pdf-artboard pdf-artboard--guided">
          <span className="page-number">{String(pageNumber).padStart(3, "0")}</span>
          <article className="pdf-page">
            {hasExtractedPage && pageSize ? (
              <div
                className="pdf-extracted-page"
                aria-label={`النص المستخرج من الصفحة ${pageNumber}`}
              >
                {extractedTextLayers.map((layer) => (
                  <span
                    key={layer.id}
                    className="pdf-extracted-text"
                    dir={layer.direction ?? "auto"}
                    style={positionedTextStyle(layer, pageSize)}
                    title={layer.name}
                  >
                    {layer.fullContent}
                  </span>
                ))}
              </div>
            ) : (
              <div className="preview-unavailable" role="status">
                <Icon name="warning" size={18} />
                لا توجد طبقات نص مستخرجة في هذه الصفحة.
              </div>
            )}
            <PdfMarkerOverlay
              regions={regions}
              selectedId={selectedId}
              activeLabel={activeLabel}
              onSelect={setSelectedId}
              onCreate={(region) => {
                const nextOrder = Math.max(0, ...regions.filter((item) => item.label !== "exclude").map((item) => item.order)) + 1;
                const next: PdfRegion = { ...region, id: `region-${Date.now()}`, order: nextOrder };
                setRegions((current) => [...current, next]);
                setSelectedId(next.id);
                setReviewState("editing");
              }}
            />
          </article>
          <span className="background-badge"><Icon name="lock" size={13} /> {backgroundName}</span>
          <span className="pdf-scope-note"><Icon name="target" size={13} /> إعادة التحليل: المنطقة المحددة فقط</span>
          {pageCount > 1 && (
            <div className="pdf-page-navigation">
              <button
                type="button"
                onClick={() =>
                  void changePage(Math.max(1, pageNumber - 1))
                }
                disabled={pageNumber === 1}
                aria-label="الصفحة السابقة"
              >
                <Icon name="chevron" size={16} />
              </button>
              <span>صفحة <b>{pageNumber}</b> من {pageCount}</span>
              <button
                type="button"
                onClick={() =>
                  void changePage(Math.min(pageCount, pageNumber + 1))
                }
                disabled={pageNumber === pageCount}
                aria-label="الصفحة التالية"
              >
                <Icon name="chevron" size={16} />
              </button>
            </div>
          )}
        </div>
      </div>

      <section className="guidance-context pdf-guidance-context" aria-label="أدوات تحديد نص PDF">
        <div className="guidance-primary">
          <ProcessingModeControl value={processingMode} onChange={setProcessingMode} />
          <label className="guidance-target segmentation-target">
            <span><Icon name="split" size={13} /> التقطيع إلى</span>
            <select
              value={segmentation}
              disabled={segmentationBusy}
              title="يُعاد تحليل الإصدار نفسه عند تغيير نمط التقطيع."
              onChange={(event) => {
                void onSegmentationChange(
                  event.target.value as PdfSegmentation,
                );
                setReviewState("editing");
              }}
            >
              {(Object.keys(pdfSegmentationLabels) as PdfSegmentation[]).map((id) => <option key={id} value={id}>{pdfSegmentationLabels[id]}</option>)}
            </select>
          </label>
        </div>

        <div className="guidance-tools pdf-marker-tools" role="toolbar" aria-label="أقلام تحديد PDF">
          <GuidanceToolButtons
            tools={markerLabels}
            activeId={activeLabel}
            onSelect={(item) => {
              setActiveLabel(item.id);
              onToolSelect?.(item.toolId);
            }}
          />
          <GuidanceHistoryActions
            canUndo={regions.length > 0}
            onUndo={undo}
            onClear={() => {
              setRegions([]);
              setSelectedId("");
              setReviewState("editing");
            }}
          />
        </div>

        <div className="pdf-region-editor">
          <div className="region-heading">
            <span><b>{regions.length}</b> مناطق · ترتيب قراءة محفوظ</span>
            {selectedRegion && <small>المنطقة {selectedRegion.order || "—"} محددة</small>}
          </div>
          {selectedRegion && (
            <label>
              <span>دلالة المنطقة</span>
              <select
                value={selectedRegion.label}
                onChange={(event) => {
                  const label = event.target.value as MarkerLabel;
                  setRegions((current) => current.map((region) => region.id === selectedRegion.id ? { ...region, label } : region));
                  setActiveLabel(label);
                  setReviewState("editing");
                }}
              >
                {markerLabels.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
          )}
          <div className="generated-layer-preview" aria-label="معاينة أسماء الطبقات">
            <span>معاينة الأسماء</span>
            <div>
              {names.length > 0
                ? names.map((name, index) => <code key={name}>{index + 1} · {name}</code>)
                : <small>لا توجد أسماء مستخرجة في الصفحة الحالية.</small>}
            </div>
          </div>
          {(segmentation === "words" || segmentation === "characters") && (
            <p className="performance-note">
              <Icon name="info" size={12} />
              تقدير الصفحة: {segmentation === "characters" ? "420–760" : "80–140"} طبقة — معلومة أداء فقط، بلا حد للطبقات.
            </p>
          )}
        </div>

        <GuidanceReview
          applying={applying}
          actionIcon="scanText"
          applyingLabel="جارٍ حفظ المناطق…"
          actionLabel="تطبيق وحفظ المناطق"
          onApply={rerun}
          reviewState={reviewState}
          version={version}
          summaryTitle="تم حفظ تنظيم المناطق"
          summaryDetail={
            <>وثيقة الطبقات v{version} · الخلفية البيضاء لم تتغير</>
          }
          warnings={
            applyWarnings.length > 0 ? (
              <span className="warning-clear">
                <Icon name="info" size={12} /> {applyWarnings.length} ملاحظة
                غير مانعة
              </span>
            ) : null
          }
          onAccept={() => {
            setReviewState("accepted");
            onNotify(
              "تم اعتماد تنظيم الطبقات المحفوظ ويمكنك متابعة تصدير PSD.",
            );
          }}
          acceptedLabel={
            <>تم اعتماد v{version} · جاهز لـ <bdi>PSD</bdi></>
          }
        />
        <WorkflowStrip current={reviewState} />
      </section>
    </>
  );
}
