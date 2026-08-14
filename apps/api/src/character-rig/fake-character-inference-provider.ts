import { createHash } from "node:crypto";
import type {
  CharacterGenerationInput,
  CharacterGenerationResult,
  CharacterIdentityTrainingInput,
  CharacterIdentityTrainingResult,
  CharacterInferenceProvider,
} from "./character-inference-provider.js";

const transparentPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export class FakeCharacterInferenceProvider implements CharacterInferenceProvider {
  readonly key = "fake";

  constructor(private readonly automatedGatePasses = true) {}

  async trainIdentity(
    input: CharacterIdentityTrainingInput,
  ): Promise<CharacterIdentityTrainingResult> {
    const fingerprint = createHash("sha256")
      .update(input.bible.id)
      .update(input.modelVersion.datasetFingerprint)
      .update(input.references.map((reference) => reference.artifact.sha256).join(":"))
      .digest("hex");
    return {
      providerModelReference: `fake:${fingerprint}`,
      metrics: { referenceCount: input.references.length },
    };
  }

  async generate(
    input: CharacterGenerationInput,
  ): Promise<CharacterGenerationResult> {
    return {
      artifact: {
        kind: "bytes",
        contentType: "image/png",
        body: Buffer.from(transparentPng),
      },
      geometry: {
        canvas: structuredClone(input.attempt.controls.canvas),
        bounds: {
          x: 0,
          y: 0,
          width: input.attempt.controls.canvas.width,
          height: input.attempt.controls.canvas.height,
        },
      },
      qualityReport: {
        thresholdsSchemaVersion: 1,
        landmarkMeanHeadWidthRatio: this.automatedGatePasses ? 0.01 : 0.2,
        landmarkCriticalPointHeadWidthRatio: this.automatedGatePasses ? 0.02 : 0.3,
        proportionDeviationRatio: this.automatedGatePasses ? 0.01 : 0.2,
        paletteMeanDeltaE00: this.automatedGatePasses ? 1 : 20,
        heroMaterialDeltaE00: this.automatedGatePasses ? 2 : 30,
        outsideMaskChangedPixelRatio: 0,
        severeDefects: this.automatedGatePasses ? [] : ["identity-drift"],
        passedAutomatedGate: this.automatedGatePasses,
      },
    };
  }
}
