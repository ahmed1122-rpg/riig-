export const characterCanonicalViews = [
  "frontal",
  "left-quarter",
  "left-profile",
  "right-quarter",
  "right-profile",
] as const;

export type CharacterCanonicalView = (typeof characterCanonicalViews)[number];

export const characterRequiredHeadParts = [
  "head",
  "left-eye",
  "right-eye",
  "left-brow",
  "right-brow",
  "nose",
  "mouth",
] as const;

export const characterRequiredFrontalBodyParts = [
  "torso",
  "left-arm",
  "right-arm",
  "left-hand",
  "right-hand",
  "left-leg",
  "right-leg",
] as const;

export const characterBibleStatuses = ["draft", "approved", "retired"] as const;
export type CharacterBibleStatus = (typeof characterBibleStatuses)[number];

export const characterModelStatuses = [
  "draft",
  "training",
  "ready",
  "failed",
  "retired",
] as const;
export type CharacterModelStatus = (typeof characterModelStatuses)[number];

export const characterGenerationStatuses = [
  "queued",
  "processing",
  "verifying",
  "needs-review",
  "approved",
  "rejected",
  "failed",
  "cancelled",
] as const;
export type CharacterGenerationStatus =
  (typeof characterGenerationStatuses)[number];

export const characterRigStatuses = [
  "draft",
  "needs-review",
  "approved",
  "exported",
  "retired",
] as const;
export type CharacterRigStatus = (typeof characterRigStatuses)[number];

export const characterJobTypes = [
  "train-identity",
  "generate-view",
  "generate-part",
  "repair-part",
  "compile-rig",
  "export-rig",
] as const;
export type CharacterJobType = (typeof characterJobTypes)[number];

export const characterJobStatuses = [
  "queued",
  "processing",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type CharacterJobStatus = (typeof characterJobStatuses)[number];

export interface CharacterArtifactReference {
  objectKey: string;
  contentType: "image/png" | "image/jpeg" | "image/webp" | "application/json" | "image/vnd.adobe.photoshop";
  sizeBytes: number;
  sha256: string;
  createdAt: string;
  retentionExpiresAt: string | null;
}

export interface CharacterPaletteEntry {
  id: string;
  label: string;
  role: "skin" | "hair" | "eye" | "clothing" | "accessory" | "outline" | "other";
  color: `#${string}`;
}

export interface CharacterMaterialDefinition {
  id: string;
  label: string;
  description: string;
  paletteEntryIds: string[];
}

export interface CharacterProportionProfile {
  headToBodyHeightRatio: number;
  shoulderToBodyHeightRatio: number;
  eyeSpacingToFaceWidthRatio: number;
  notes: string[];
}

export interface CharacterBible {
  schemaVersion: "1.0";
  id: string;
  projectId: string;
  version: number;
  revision: number;
  status: CharacterBibleStatus;
  displayName: string;
  identityDescription: string;
  negativeConstraints: string[];
  distinguishingFeatures: string[];
  proportions: CharacterProportionProfile;
  palette: CharacterPaletteEntry[];
  materials: CharacterMaterialDefinition[];
  createdByUserId: string;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CharacterReferenceRole =
  | "identity-primary"
  | "canonical-view"
  | "body-proportion"
  | "style-material"
  | "part-mask"
  | "pose-control"
  | "depth-control";

export type CharacterReferenceRights =
  | "owned-by-user"
  | "licensed-for-model-use"
  | "user-provided-private-reference";

export interface CharacterReferenceAsset {
  id: string;
  projectId: string;
  bibleId: string;
  role: CharacterReferenceRole;
  canonicalView: CharacterCanonicalView | null;
  rightsClassification: CharacterReferenceRights;
  rightsAttestedByUserId: string;
  rightsAttestedAt: string;
  artifact: CharacterArtifactReference;
  width: number;
  height: number;
  createdAt: string;
}

export interface CharacterIdentityModelVersion {
  id: string;
  projectId: string;
  bibleId: string;
  version: number;
  status: CharacterModelStatus;
  providerKey: string;
  providerModelReference: string | null;
  baseModelReference: string;
  datasetFingerprint: string;
  trainingConfiguration: Record<string, string | number | boolean>;
  trainingMetrics?: Record<string, number>;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CharacterGenerationTarget =
  | { kind: "canonical-view"; view: CharacterCanonicalView }
  | { kind: "part"; view: CharacterCanonicalView; partName: string }
  | { kind: "masked-repair"; view: CharacterCanonicalView; partName: string };

export interface CharacterGenerationControls {
  seed: number;
  poseReferenceId: string | null;
  depthReferenceId: string | null;
  maskReferenceId: string | null;
  parameters: Record<string, string | number | boolean>;
}

export interface CharacterQualityReport {
  thresholdsSchemaVersion: number;
  landmarkMeanHeadWidthRatio: number | null;
  landmarkCriticalPointHeadWidthRatio: number | null;
  proportionDeviationRatio: number | null;
  paletteMeanDeltaE00: number | null;
  heroMaterialDeltaE00: number | null;
  outsideMaskChangedPixelRatio: number | null;
  severeDefects: string[];
  passedAutomatedGate: boolean;
}

export interface CharacterGenerationAttempt {
  id: string;
  projectId: string;
  bibleId: string;
  identityModelVersionId: string;
  target: CharacterGenerationTarget;
  status: CharacterGenerationStatus;
  controls: CharacterGenerationControls;
  requestHash: string;
  idempotencyKey: string;
  outputArtifact: CharacterArtifactReference | null;
  qualityReport: CharacterQualityReport | null;
  failureCode: string | null;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterGenerationReview {
  id: string;
  projectId: string;
  generationAttemptId: string;
  decision: "approved" | "rejected" | "changes-requested";
  reason: string;
  reviewerUserId: string;
  operationId: string;
  createdAt: string;
}

export interface CharacterRigNode {
  id: string;
  parentId: string | null;
  kind: "group" | "raster" | "trigger";
  name: `+${string}`;
  canonicalView: CharacterCanonicalView | null;
  semanticPart: string | null;
  sourceGenerationAttemptId: string | null;
  artifact: CharacterArtifactReference | null;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  visible: boolean;
  locked: boolean;
  opacity: number;
  zIndex: number;
}

export interface CharacterRigExportManifest {
  schemaVersion: "1.0";
  rigVersionId: string;
  projectId: string;
  bibleId: string;
  canvas: { width: number; height: number; colorMode: "RGB"; bitsPerChannel: 8 };
  canonicalViews: CharacterCanonicalView[];
  generatedAt: string;
  nodes: Array<{
    id: string;
    parentId: string | null;
    path: string;
    kind: CharacterRigNode["kind"];
    canonicalView: CharacterCanonicalView | null;
    semanticPart: string | null;
    sourceGenerationAttemptId: string | null;
    artifactSha256: string | null;
  }>;
}

export interface CharacterRigVersion {
  schemaVersion: "1.0";
  id: string;
  projectId: string;
  bibleId: string;
  version: number;
  status: CharacterRigStatus;
  sourceFingerprint?: string;
  canvas?: { width: number; height: number };
  nodes: CharacterRigNode[];
  psdArtifact: CharacterArtifactReference | null;
  manifestArtifact: CharacterArtifactReference | null;
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CharacterJob {
  id: string;
  projectId: string;
  type: CharacterJobType;
  status: CharacterJobStatus;
  operationKey: string;
  requestHash: string;
  payload: Record<string, string | number | boolean | null>;
  attempt: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
