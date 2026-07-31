import type {
  AutoFillPolicy,
  ImageGuidanceStroke,
  LayerBounds,
  LayerDocument,
} from "@motionprep/contracts";

export interface PrepareImageInput {
  projectId: string;
  sourceVersionId: string;
  source: Buffer;
}

export interface PreparedRasterAsset {
  layerId: string;
  objectKey: string;
  contentType: "image/png";
  sizeBytes: number;
  sha256: string;
  body: Buffer;
}

export interface PreparedImageSource {
  document: LayerDocument;
  rasterAssets: PreparedRasterAsset[];
}

export class MediaProcessingError extends Error {
  constructor(
    readonly code:
      | "IMAGE_DECODE_FAILED"
      | "IMAGE_DIMENSIONS_MISSING"
      | "IMAGE_HAS_NO_VISIBLE_PIXELS"
      | "IMAGE_GUIDANCE_ASSET_MISMATCH",
    message: string,
  ) {
    super(message);
  }
}

export interface ApplyRasterGuidanceInput {
  source: Buffer;
  documentWidth: number;
  documentHeight: number;
  layerBounds?: LayerBounds;
  strokes: readonly ImageGuidanceStroke[];
  autoFillPolicy?: AutoFillPolicy;
}

export interface AppliedRasterGuidance {
  refined: Buffer;
  separated: Buffer | null;
  changed: boolean;
  warnings: string[];
}
