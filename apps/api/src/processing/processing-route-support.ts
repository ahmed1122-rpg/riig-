import type { FastifyReply, FastifyRequest } from "fastify";
import { MAX_LAYER_TEXT_CHARACTERS } from "@motionprep/contracts";
import { z } from "zod";
import { UsageLimitError } from "../billing/usage-meter.js";
import { sendApiError } from "../http/api-response.js";
import { createDomainErrorResponder } from "../http/domain-route-error.js";
import { ProcessingDomainError } from "./processing-service.js";

export const createSchema = z.object({
  projectId: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  pdfSeparationMode: z
    .enum(["heading", "topic", "sentence", "line", "word", "character"])
    .optional(),
});
export const jobParamsSchema = z.object({ jobId: z.string().uuid() });
export const documentParamsSchema = z.object({ projectId: z.string().uuid() });
export const layerAssetParamsSchema = z.object({
  projectId: z.string().uuid(),
  layerId: z.string().min(1).max(128),
});
export const documentQuerySchema = z.object({
  sourceVersionId: z.string().uuid().optional(),
});
export const layerAssetQuerySchema = z.object({
  sourceVersionId: z.string().uuid(),
  assetSha256: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
});
const layerStateUpdateSchema = z.object({
  id: z.string().min(1).max(128),
  name: z
    .string()
    .min(2)
    .max(121)
    .refine(
      (name) =>
        name.startsWith("+") &&
        !name.startsWith("++") &&
        !/[\u0000-\u001F\u007F\\/]/u.test(name),
    )
    .transform((name) => name as `+${string}`),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: z.number().finite().min(0).max(1),
  zIndex: z.number().int().nonnegative().max(1_000_000),
  readingOrder: z.number().int().nonnegative().max(1_000_000).optional(),
  bounds: z
    .object({
      x: z.number().finite().nonnegative().max(1_000_000),
      y: z.number().finite().nonnegative().max(1_000_000),
      width: z.number().finite().positive().max(1_000_000),
      height: z.number().finite().positive().max(1_000_000),
    })
    .optional(),
  direction: z.enum(["ltr", "rtl"]).optional(),
  textAlign: z.enum(["start", "center", "end", "justify"]).optional(),
  fontFamily: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((value) => !/[\u0000-\u001F\u007F]/u.test(value))
    .optional(),
  fontSize: z.number().finite().min(1).max(500).optional(),
  fullText: z
    .string()
    .trim()
    .min(1)
    .max(MAX_LAYER_TEXT_CHARACTERS)
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value))
    .optional(),
});
export const updateDocumentSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  layers: z.array(layerStateUpdateSchema).min(1).max(1_000),
});
const layerCommandScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("document") }),
  z.object({
    kind: z.literal("page"),
    pageNumber: z.number().int().positive().max(250),
  }),
  z.object({
    kind: z.literal("parent"),
    parentId: z.string().min(1).max(128).nullable(),
  }),
  z.object({
    kind: z.literal("layers"),
    layerIds: z.array(z.string().min(1).max(128)).min(1).max(5_000),
  }),
]);
const layerDocumentCommandSchema = z.union([
  z.object({
    kind: z.literal("normalize-names"),
    scope: layerCommandScopeSchema,
  }),
  z.object({
    kind: z.literal("arrange-reading-order"),
    scope: layerCommandScopeSchema,
    order: z.enum(["reading", "reverse"]),
  }),
  z
    .object({
      kind: z.literal("update-state"),
      scope: layerCommandScopeSchema,
      visible: z.boolean().optional(),
      locked: z.boolean().optional(),
    })
    .refine((value) => value.visible !== undefined || value.locked !== undefined),
  z.object({
    kind: z.literal("move-layer"),
    layerId: z.string().min(1).max(128),
    targetLayerId: z.string().min(1).max(128),
    position: z.enum(["before", "after"]),
  }),
]);
export const layerCommandRequestSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  command: layerDocumentCommandSchema,
});
const normalizedPointSchema = z.object({
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
});
const imageStrokeSchema = z.object({
  id: z.string().min(1).max(128),
  targetLayerId: z.string().min(1).max(128).nullable(),
  kind: z.enum(["include", "exclude", "separate"]),
  brushSize: z.number().finite().min(2).max(80),
  points: z.array(normalizedPointSchema).min(2).max(1_000),
  createdAt: z.string().datetime(),
});
const pdfRegionSchema = z
  .object({
    id: z.string().min(1).max(128),
    pageNumber: z.number().int().positive().max(250),
    kind: z.enum(["heading", "line", "topic", "ignore"]),
    start: normalizedPointSchema,
    end: normalizedPointSchema,
    readingOrder: z.number().int().nonnegative().nullable(),
    createdAt: z.string().datetime(),
  })
  .superRefine((value, context) => {
    if (
      value.end.x - value.start.x < 0.005 ||
      value.end.y - value.start.y < 0.005
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "The PDF marker region must have a visible positive area.",
      });
    }
  });
export const guidedRefinementSchema = z
  .object({
    sourceVersionId: z.string().uuid(),
    baseRevision: z.number().int().positive(),
    mode: z.enum(["automatic", "manual", "guided"]),
    imageStrokes: z.array(imageStrokeSchema).max(100),
    pdfRegions: z.array(pdfRegionSchema).max(100),
  })
  .superRefine((value, context) => {
    const pointCount = value.imageStrokes.reduce(
      (sum, stroke) => sum + stroke.points.length,
      0,
    );
    if (pointCount > 10_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imageStrokes"],
        message: "A refinement may contain at most 10,000 stroke points.",
      });
    }
  });
export const splitTextLayerSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  layerId: z.string().min(1).max(128),
  offset: z.number().int().positive().max(1_000_000),
});
export const mergeTextLayersSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  layerIds: z.array(z.string().min(1).max(128)).min(2).max(50),
  separator: z.enum(["space", "newline"]),
});
export const regionalOcrSchema = z
  .object({
    sourceVersionId: z.string().uuid(),
    baseRevision: z.number().int().positive(),
    pageNumber: z.number().int().positive().max(250),
    start: normalizedPointSchema,
    end: normalizedPointSchema,
  })
  .superRefine((value, context) => {
    if (
      Math.abs(value.end.x - value.start.x) < 0.005 ||
      Math.abs(value.end.y - value.start.y) < 0.005
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["end"],
        message: "The regional OCR selection is too small.",
      });
    }
  });
export const navigateHistorySchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  direction: z.enum(["undo", "redo"]),
});
export const refineImageEdgesSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  layerId: z.string().min(1).max(128),
  radius: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  strength: z.number().finite().min(0.1).max(1),
});
export const mergeImageLayersSchema = z.object({
  sourceVersionId: z.string().uuid(),
  baseRevision: z.number().int().positive(),
  layerIds: z.array(z.string().min(1).max(128)).min(2).max(15),
});

const processingDomainError = createDomainErrorResponder(
  ProcessingDomainError,
  (code) =>
    code === "PROCESSING_NOT_FOUND" ||
    code === "DOCUMENT_NOT_FOUND" ||
    code === "LAYER_ASSET_NOT_FOUND"
      ? 404
      : code === "DOCUMENT_REVISION_CONFLICT" ||
          code === "IDEMPOTENCY_CONFLICT" ||
          code === "PROCESSING_IN_PROGRESS" ||
          code === "SOURCE_NOT_CURRENT" ||
          code === "SOURCE_NOT_READY" ||
          code === "GUIDANCE_DUPLICATE" ||
          code === "EDIT_HISTORY_UNAVAILABLE"
        ? 409
        : code === "LAYER_ASSET_INTEGRITY_FAILED" ||
            code === "SOURCE_INTEGRITY_FAILED"
          ? 500
          : code === "IMAGE_LAYER_LIMIT_EXCEEDED" ||
              code === "OCR_REQUIRED" ||
              code === "OCR_FAILED" ||
              code === "INVALID_DOCUMENT_OPERATION"
            ? 422
            : code === "PDF_TOO_MANY_PAGES" ||
                code === "PDF_TEXT_LIMIT_EXCEEDED"
              ? 413
              : 400,
);

export function sendProcessingError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (error instanceof UsageLimitError) {
    return sendApiError(
      reply,
      request.id,
      error.code === "SUBSCRIPTION_INACTIVE" ? 403 : 429,
      error.code,
      error.message,
    );
  }
  return processingDomainError(error, request, reply);
}
