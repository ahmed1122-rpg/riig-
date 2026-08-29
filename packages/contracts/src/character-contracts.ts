export const characterCanonicalViews = ["frontal"] as const;

export type CharacterCanonicalView = (typeof characterCanonicalViews)[number];

export const characterBibleStatuses = ["draft", "approved", "retired"] as const;
export type CharacterBibleStatus = (typeof characterBibleStatuses)[number];

export const characterRigStatuses = [
  "draft",
  "needs-review",
  "approved",
  "exported",
  "retired",
] as const;
export type CharacterRigStatus = (typeof characterRigStatuses)[number];

/** Job types accepted by the current source-preserving application service. */
export const characterJobTypes = ["compile-rig"] as const;
export type CharacterJobType = (typeof characterJobTypes)[number];

/**
 * Values that may still exist in databases created before the source-preserving
 * product decision. They are readable so workers can fail them closed, but the
 * application must never enqueue them again.
 */
export const characterStoredJobTypes = [
  "train-identity",
  "generate-view",
  "generate-part",
  "repair-part",
  "compile-rig",
  "export-rig",
] as const;
export type CharacterStoredJobType = (typeof characterStoredJobTypes)[number];

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
  "identity-primary";

export type CharacterReferenceRights =
  | "owned-by-user"
  | "user-provided-private-reference";

export interface CharacterReferenceAsset {
  id: string;
  projectId: string;
  bibleId: string;
  /** Upload version from which this immutable reference was copied. */
  sourceVersionId: string;
  role: CharacterReferenceRole;
  canonicalView: CharacterCanonicalView;
  rightsClassification: CharacterReferenceRights;
  rightsAttestedByUserId: string;
  rightsAttestedAt: string;
  artifact: CharacterArtifactReference;
  width: number;
  height: number;
  createdAt: string;
}

export interface CharacterRigReview {
  id: string;
  projectId: string;
  rigVersionId: string;
  decision: "approved" | "rejected";
  reason: string;
  reviewerUserId: string;
  operationId: string;
  createdAt: string;
}

export interface CharacterRigNode {
  id: string;
  parentId: string | null;
  kind: "group" | "raster";
  name: `+${string}`;
  canonicalView: CharacterCanonicalView | null;
  semanticPart: string | null;
  /** Source layer used by the non-generative, source-preserving pipeline. */
  sourceLayerId: string | null;
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
  canonicalViews: [CharacterCanonicalView];
  generatedAt: string;
  sourceIntegrity: {
    mode: "pixel-exact";
    sourceVersionId: string;
    sourceSha256: string;
    verified: true;
  };
  nodes: Array<{
    id: string;
    parentId: string | null;
    path: string;
    kind: CharacterRigNode["kind"];
    canonicalView: CharacterCanonicalView | null;
    semanticPart: string | null;
    sourceLayerId: string | null;
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
  /** Source-preserving rigs never invoke a model or synthesize pixels. */
  pipeline: "source-preserving";
  failureCode: string | null;
  sourceFingerprint: string;
  source: {
    sourceVersionId: string;
    referenceId: string;
    artifact: CharacterArtifactReference;
    layerDocumentRevision: number;
    pixelIdentityRequired: true;
  };
  canvas: { width: number; height: number };
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
  type: CharacterStoredJobType;
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
