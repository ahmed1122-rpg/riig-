import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../../shared/Icon";
import type { Layer, PdfSegmentation } from "../../types";
import { isPageLayer } from "./workspaceLayerKinds";
import { pdfSegmentationLabels } from "../../shared/pdfSegmentation";
import {
  createGuidancePromptTools,
  GuidanceHistoryActions,
  GuidanceReview,
  GuidanceToolButtons,
  ProcessingModeControl,
  useGuidanceReview,
  WorkflowStrip,
  type CorrectionMode,
  type ReadyWorkspaceToolId,
} from "./GuidanceEditorShared";
import {
  PdfMarkerOverlay,
  type MarkerLabel,
  type PdfRegion,
} from "./PdfMarkerOverlay";
import {
  hasValidPdfRegionGeometry,
  normalizePdfRegionOrders,
} from "./pdfRegionGeometry";
import {
  findTopPreviewLayerAtPoint,
  projectPreviewLayers,
} from "./layerPreviewProjection";
import {
  PdfExtractedTextPage,
  type PdfTextEdit,
} from "./PdfExtractedTextPage";
import { PdfRegionCoordinateForm } from "./PdfRegionCoordinateForm";
import type { PdfGuidanceEditorProps } from "./PdfGuidanceEditor.types";

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

export function PdfGuidanceEditor({
  segmentation,
  layers,
  pageNumber = 1,
  pageCount = 1,
  pageSize,
  selectedLayerId = "",
  solo = false,
  onSelectedLayerChange,
  onTextLayerChange,
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
  onDraftDirtyChange,
}: PdfGuidanceEditorProps) {
  const [processingMode, setProcessingMode] = useState<CorrectionMode>("guided");
  const [activeLabel, setActiveLabel] = useState<MarkerLabel>("line");
  const [regions, setRegions] = useState<PdfRegion[]>([]);
  const [keyboardRegion, setKeyboardRegion] = useState({
    x: 10,
    y: 10,
    width: 50,
    height: 10,
  });
  const [keyboardRegionError, setKeyboardRegionError] = useState("");
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  useEffect(() => {
    onDraftDirtyChange?.(regions.length > 0);
  }, [onDraftDirtyChange, regions.length]);
  useEffect(
    () => () => onDraftDirtyChange?.(false),
    [onDraftDirtyChange],
  );
  const historyNavigateRef = useRef(onHistoryNavigate);
  historyNavigateRef.current = onHistoryNavigate;
  const [selectedId, setSelectedId] = useState("");
  const [textEdit, setTextEdit] = useState<PdfTextEdit>();
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
      projectPreviewLayers(layers, {
        pageNumber,
        kinds: ["text"],
        ...(solo && selectedLayerId ? { soloLayerId: selectedLayerId } : {}),
      }).filter((layer) => layer.bounds && layer.fullText),
    [layers, pageNumber, selectedLayerId, solo],
  );
  const names = useMemo(
    () => extractedTextLayers.slice(0, 3),
    [extractedTextLayers],
  );
  const backgroundName =
    layers.find(
      (layer) => isPageLayer(layer) && layer.pageNumber === pageNumber,
    )?.name ??
    `+page_${String(pageNumber).padStart(3, "0")}_background`;
  const selectedRegion = regions.find((region) => region.id === selectedId);
  const beginTextEdit = (layer: Layer) => {
    onSelectedLayerChange?.(layer.id);
    if (!onTextLayerChange) return;
    if (layer.locked || layer.fixed) {
      onNotify("افتح قفل طبقة النص قبل تحرير محتواها على الصفحة.");
      return;
    }
    setTextEdit({ layerId: layer.id, draft: layer.fullText ?? "" });
  };
  const finishTextEdit = (save: boolean) => {
    if (!textEdit) return;
    const normalized = textEdit.draft.trim();
    if (save && normalized.length > 0) {
      onTextLayerChange?.(textEdit.layerId, normalized);
      onNotify("تم تحديث النص وسيُحفظ تلقائيًا كمراجعة قابلة للتراجع.");
    } else if (save) {
      onNotify("لا يمكن حفظ طبقة نصية فارغة.");
    }
    setTextEdit(undefined);
  };

  useEffect(() => {
    setRegions([]);
    setSelectedId("");
    setKeyboardRegionError("");
    setTextEdit(undefined);
  }, [segmentation]);

  const addRegion = (region: Omit<PdfRegion, "id" | "order">) => {
    if (!hasValidPdfRegionGeometry(region)) {
      onNotify("تعذر إضافة منطقة غير مرئية أو خارج حدود الصفحة.");
      return false;
    }
    const id = `region-${crypto.randomUUID()}`;
    setRegions((current) =>
      normalizePdfRegionOrders([...current, { ...region, id, order: null }]),
    );
    setSelectedId(id);
    setReviewState("editing");
    return true;
  };

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
    if (regions.length === 0) {
      onNotify("حدّد منطقة واحدة على الأقل داخل الصفحة.");
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
      const confirmed = onConfirmDiscardRegions
        ? await onConfirmDiscardRegions(
            "لم تُطبّق المناطق الحالية. سيؤدي الانتقال إلى تجاهلها.",
          )
        : true;
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
            <PdfExtractedTextPage
              layers={extractedTextLayers}
              pageNumber={pageNumber}
              pageSize={pageSize}
              selectedLayerId={selectedLayerId}
              textEdit={textEdit}
              onTextEditChange={setTextEdit}
              onTextEditFinish={finishTextEdit}
            />
            <PdfMarkerOverlay
              regions={regions}
              selectedId={selectedId}
              activeLabel={activeLabel}
              onSelect={setSelectedId}
              onCreate={addRegion}
              onCanvasClick={(point) => {
                if (!pageSize || !onSelectedLayerChange) return;
                const x = point.x * pageSize.width;
                const y = point.y * pageSize.height;
                const target = findTopPreviewLayerAtPoint(
                  extractedTextLayers,
                  { x, y },
                );
                if (target) onSelectedLayerChange(target.id);
              }}
              onCanvasDoubleClick={(point) => {
                if (!pageSize) return;
                const target = findTopPreviewLayerAtPoint(
                  extractedTextLayers,
                  {
                    x: point.x * pageSize.width,
                    y: point.y * pageSize.height,
                  },
                );
                if (target) beginTextEdit(target);
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
                  setRegions((current) =>
                    normalizePdfRegionOrders(
                      current.map((region) =>
                        region.id === selectedRegion.id
                          ? { ...region, label }
                          : region,
                      ),
                    ),
                  );
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
                ? names.map((layer, index) => <code key={layer.id}>{index + 1} · {layer.name}</code>)
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

        <PdfRegionCoordinateForm
          keyboardRegion={keyboardRegion}
          setKeyboardRegion={setKeyboardRegion}
          error={keyboardRegionError}
          setError={setKeyboardRegionError}
          activeLabel={activeLabel}
          onAdd={addRegion}
        />

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
