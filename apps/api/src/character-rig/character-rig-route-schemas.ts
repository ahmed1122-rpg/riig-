import { z } from "zod";

export const characterProjectParamsSchema = z.object({
  projectId: z.string().uuid(),
});

export const characterGenerationParamsSchema = z.object({
  projectId: z.string().uuid(),
  generationAttemptId: z.string().uuid(),
});

export const characterRigParamsSchema = z.object({
  projectId: z.string().uuid(),
  rigVersionId: z.string().uuid(),
});

export const characterRigArtifactParamsSchema = characterRigParamsSchema.extend({
  artifactType: z.enum(["psd", "manifest"]),
});

export const characterBibleDraftSchema = z.object({
  bibleId: z.string().uuid().nullable(),
  expectedRevision: z.number().int().positive().nullable(),
  displayName: z.string().trim().min(2).max(100),
  identityDescription: z.string().trim().min(20).max(4_000),
  negativeConstraints: z.array(z.string().trim().min(3).max(300)).max(50),
  distinguishingFeatures: z.array(z.string().trim().min(3).max(300)).max(50),
  proportions: z.object({
    headToBodyHeightRatio: z.number().min(0.05).max(0.8),
    shoulderToBodyHeightRatio: z.number().min(0.05).max(0.8),
    eyeSpacingToFaceWidthRatio: z.number().min(0.05).max(0.8),
    notes: z.array(z.string().trim().min(2).max(300)).max(30),
  }),
  palette: z
    .array(
      z.object({
        id: z.string().uuid(),
        label: z.string().trim().min(1).max(80),
        role: z.enum([
          "skin",
          "hair",
          "eye",
          "clothing",
          "accessory",
          "outline",
          "other",
        ]),
        color: z.string().regex(/^#[a-fA-F0-9]{6}$/u),
      }),
    )
    .max(40),
  materials: z
    .array(
      z.object({
        id: z.string().uuid(),
        label: z.string().trim().min(1).max(80),
        description: z.string().trim().min(3).max(500),
        paletteEntryIds: z.array(z.string().uuid()).max(20),
      }),
    )
    .max(30),
});

export const characterBibleApprovalSchema = z.object({
  bibleId: z.string().uuid(),
  expectedRevision: z.number().int().positive(),
});

export const characterReferenceSchema = z.object({
  bibleId: z.string().uuid(),
  sourceVersionId: z.string().uuid(),
  role: z.enum([
    "identity-primary",
    "canonical-view",
    "body-proportion",
    "style-material",
    "part-mask",
    "pose-control",
    "depth-control",
  ]),
  canonicalView: z
    .enum([
      "frontal",
      "left-quarter",
      "left-profile",
      "right-quarter",
      "right-profile",
    ])
    .nullable(),
  rightsClassification: z.enum([
    "owned-by-user",
    "licensed-for-model-use",
    "user-provided-private-reference",
  ]),
});

export const characterIdentityBootstrapSchema = z.object({
  bibleId: z.string().uuid(),
});

const characterGenerationTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("canonical-view"),
    view: z.enum([
      "frontal",
      "left-quarter",
      "left-profile",
      "right-quarter",
      "right-profile",
    ]),
  }),
  z.object({
    kind: z.literal("part"),
    view: z.enum([
      "frontal",
      "left-quarter",
      "left-profile",
      "right-quarter",
      "right-profile",
    ]),
    partName: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/u),
  }),
  z.object({
    kind: z.literal("masked-repair"),
    view: z.enum([
      "frontal",
      "left-quarter",
      "left-profile",
      "right-quarter",
      "right-profile",
    ]),
    partName: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/u),
  }),
]);

export const characterGenerationSchema = z.object({
  bibleId: z.string().uuid(),
  identityModelVersionId: z.string().uuid(),
  target: characterGenerationTargetSchema,
  controls: z.object({
    seed: z.number().int().min(0).max(2_147_483_647),
    canvas: z
      .object({
        width: z.number().int().positive().max(10_000),
        height: z.number().int().positive().max(10_000),
      })
      .refine((value) => value.width * value.height <= 32_000_000),
    poseReferenceId: z.string().uuid().nullable(),
    depthReferenceId: z.string().uuid().nullable(),
    maskReferenceId: z.string().uuid().nullable(),
    parameters: z.record(
      z.union([z.string(), z.number().finite(), z.boolean()]),
    ),
  }),
});

export const characterGenerationReviewSchema = z.object({
  decision: z.enum(["approved", "rejected", "changes-requested"]),
  reason: z.string().trim().min(3).max(2_000),
});

export const characterRigReviewSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason: z.string().trim().min(3).max(2_000),
});

export const characterRigCompilationSchema = z
  .object({
    bibleId: z.string().uuid(),
    width: z.number().int().positive().max(10_000),
    height: z.number().int().positive().max(10_000),
  })
  .refine((value) => value.width * value.height <= 32_000_000, {
    message: "Character rig canvas exceeds the safe pixel budget.",
  });
