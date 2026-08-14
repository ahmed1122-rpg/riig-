import { request } from "./transport";
import type {
  LayerDocumentEditView,
  LayerDocumentView,
} from "./models";
import type { LayerDocumentCommand } from "@motionprep/contracts";

export function updateLayerDocument(
  projectId: string,
  sourceVersionId: string,
  baseRevision: number,
  layers: Array<{
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    zIndex: number;
    readingOrder?: number;
    bounds?: { x: number; y: number; width: number; height: number };
    direction?: "ltr" | "rtl";
    textAlign?: "start" | "center" | "end" | "justify";
    fontFamily?: string;
    fontSize?: number;
    fullText?: string;
  }>,
  operationId: string = crypto.randomUUID(),
): Promise<LayerDocumentView> {
  return request<LayerDocumentView>(
    `/v1/projects/${projectId}/layer-document`,
    {
      method: "PATCH",
      headers: { "x-idempotency-key": operationId },
      body: JSON.stringify({
        sourceVersionId,
        baseRevision,
        layers,
      }),
    },
  );
}

export function runLayerDocumentCommand(
  projectId: string,
  sourceVersionId: string,
  baseRevision: number,
  command: LayerDocumentCommand,
  operationId: string = crypto.randomUUID(),
): Promise<LayerDocumentView> {
  return request<LayerDocumentView>(
    `/v1/projects/${encodeURIComponent(projectId)}/layer-document/commands`,
    {
      method: "POST",
      headers: { "x-idempotency-key": operationId },
      body: JSON.stringify({ sourceVersionId, baseRevision, command }),
    },
  );
}

export function applyGuidedRefinement(
  projectId: string,
  input: {
    sourceVersionId: string;
    baseRevision: number;
    mode: "automatic" | "manual" | "guided";
    imageStrokes: Array<{
      id: string;
      targetLayerId: string | null;
      kind: "include" | "exclude" | "separate";
      brushSize: number;
      points: Array<{ x: number; y: number }>;
      createdAt: string;
    }>;
    pdfRegions: Array<{
      id: string;
      pageNumber: number;
      kind: "heading" | "line" | "topic" | "ignore";
      start: { x: number; y: number };
      end: { x: number; y: number };
      readingOrder: number | null;
      createdAt: string;
    }>;
  },
): Promise<{
  document: LayerDocumentView;
  affectedLayerIds: string[];
  createdLayerIds: string[];
  warnings: string[];
}> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/guided-refinements`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function splitPdfTextLayer(
  projectId: string,
  input: {
    sourceVersionId: string;
    baseRevision: number;
    layerId: string;
    offset: number;
  },
): Promise<LayerDocumentEditView> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/layer-document/text/split`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );
}

export function mergePdfTextLayers(
  projectId: string,
  input: {
    sourceVersionId: string;
    baseRevision: number;
    layerIds: string[];
    separator: "space" | "newline";
  },
): Promise<LayerDocumentEditView> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/layer-document/text/merge`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );
}

export function navigateLayerDocumentHistory(
  projectId: string,
  input: {
    sourceVersionId: string;
    baseRevision: number;
    direction: "undo" | "redo";
  },
): Promise<LayerDocumentView> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/layer-document/history`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function refineImageLayerEdges(
  projectId: string,
  input: {
    sourceVersionId: string;
    baseRevision: number;
    layerId: string;
    radius: 1 | 2 | 3;
    strength: number;
  },
): Promise<LayerDocumentEditView> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/layer-document/image/refine-edges`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );
}

export function mergeImageLayers(
  projectId: string,
  input: {
    sourceVersionId: string;
    baseRevision: number;
    layerIds: string[];
  },
): Promise<LayerDocumentEditView> {
  return request(
    `/v1/projects/${encodeURIComponent(projectId)}/layer-document/image/merge`,
    {
      method: "POST",
      headers: { "x-idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(input),
    },
  );
}

export function getProjectLayerDocument(
  projectId: string,
  signal?: AbortSignal,
  sourceVersionId?: string,
): Promise<LayerDocumentView> {
  const query = sourceVersionId
    ? `?sourceVersionId=${encodeURIComponent(sourceVersionId)}`
    : "";
  return request<LayerDocumentView>(
    `/v1/projects/${encodeURIComponent(projectId)}/layer-document${query}`,
    { signal },
  );
}
