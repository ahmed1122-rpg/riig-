import type { applyGuidedRefinement } from "../../lib/api";

export type GuidedRefinementInput = Parameters<
  typeof applyGuidedRefinement
>[1];

export interface GuidedRefinementContext {
  sourceVersionId: string;
  baseRevision: number;
  appliedAt: string;
}

export interface ImageGuideInput {
  mode: "automatic" | "manual" | "guided";
  strokes: Array<{
    id: string;
    prompt: "keep" | "exclude" | "separate";
    size: number;
    points: Array<{ x: number; y: number }>;
  }>;
}

export interface PdfGuideInput {
  mode: "automatic" | "manual" | "guided";
  regions: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label: "heading" | "line" | "topic" | "exclude";
    order: number;
  }>;
}

export function createImageGuidedRefinementInput(
  input: ImageGuideInput,
  activeLayerId: string,
  context: GuidedRefinementContext,
): GuidedRefinementInput {
  return {
    sourceVersionId: context.sourceVersionId,
    baseRevision: context.baseRevision,
    mode: input.mode,
    imageStrokes: input.strokes.map((stroke) => ({
      id: stroke.id,
      targetLayerId: activeLayerId || null,
      kind: stroke.prompt === "keep" ? "include" : stroke.prompt,
      brushSize: stroke.size,
      points: stroke.points,
      createdAt: context.appliedAt,
    })),
    pdfRegions: [],
  };
}

export function createPdfGuidedRefinementInput(
  input: PdfGuideInput,
  activePdfPage: number,
  context: GuidedRefinementContext,
): GuidedRefinementInput {
  return {
    sourceVersionId: context.sourceVersionId,
    baseRevision: context.baseRevision,
    mode: input.mode,
    imageStrokes: [],
    pdfRegions: input.regions.map((region) => ({
      id: region.id,
      pageNumber: activePdfPage,
      kind: region.label === "exclude" ? "ignore" : region.label,
      start: { x: region.x, y: region.y },
      end: {
        x: Math.min(1, region.x + region.width),
        y: Math.min(1, region.y + region.height),
      },
      readingOrder: region.label === "exclude" ? null : region.order,
      createdAt: context.appliedAt,
    })),
  };
}
