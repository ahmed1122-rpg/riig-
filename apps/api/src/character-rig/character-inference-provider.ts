import type {
  CharacterBible,
  CharacterGenerationAttempt,
  CharacterGenerationGeometry,
  CharacterIdentityModelVersion,
  CharacterQualityReport,
  CharacterReferenceAsset,
} from "@motionprep/contracts";

export interface CharacterIdentityTrainingInput {
  bible: CharacterBible;
  modelVersion: CharacterIdentityModelVersion;
  references: CharacterReferenceAsset[];
}

export interface CharacterIdentityTrainingResult {
  providerModelReference: string;
  metrics: Record<string, number>;
}

export interface CharacterGenerationInput {
  bible: CharacterBible;
  modelVersion: CharacterIdentityModelVersion;
  attempt: CharacterGenerationAttempt;
  references: CharacterReferenceAsset[];
}

type CharacterGenerationArtifact =
  | {
      kind: "bytes";
      contentType: "image/png";
      body: Buffer;
    }
  | {
      kind: "stored-object";
      objectKey: string;
      contentType: "image/png";
      sizeBytes: number;
      sha256: string;
    };

export interface CharacterGenerationResult {
  artifact: CharacterGenerationArtifact;
  geometry: CharacterGenerationGeometry;
  qualityReport: CharacterQualityReport;
}

export interface CharacterInferenceProvider {
  readonly key: string;
  trainIdentity(
    input: CharacterIdentityTrainingInput,
  ): Promise<CharacterIdentityTrainingResult>;
  generate(
    input: CharacterGenerationInput,
  ): Promise<CharacterGenerationResult>;
}

export class CharacterProviderError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
