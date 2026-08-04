import { z } from "zod";

export const processingJobOptionsSchema = z.object({
  pdfSeparationMode: z
    .enum(["heading", "topic", "sentence", "line", "word", "character"])
    .default("sentence"),
  pdfRegionOcr: z
    .object({
      pageNumber: z.number().int().positive().max(250),
      start: z.object({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
      }),
      end: z.object({
        x: z.number().finite().min(0).max(1),
        y: z.number().finite().min(0).max(1),
      }),
      baseRevision: z.number().int().positive(),
      actorUserId: z.string().uuid(),
      operationId: z.string().min(1).max(256),
    })
    .optional(),
});
