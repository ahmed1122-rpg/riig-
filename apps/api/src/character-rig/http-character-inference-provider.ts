import { z } from "zod";
import type {
  CharacterGenerationInput,
  CharacterGenerationResult,
  CharacterIdentityTrainingInput,
  CharacterIdentityTrainingResult,
  CharacterInferenceProvider,
} from "./character-inference-provider.js";
import { CharacterProviderError } from "./character-inference-provider.js";

const trainingResponseSchema = z.object({
  providerModelReference: z.string().min(1).max(500),
  metrics: z.record(z.string(), z.number().finite()).default({}),
});

const qualityReportSchema = z.object({
  thresholdsSchemaVersion: z.number().int().positive(),
  landmarkMeanHeadWidthRatio: z.number().finite().nonnegative().nullable(),
  landmarkCriticalPointHeadWidthRatio: z.number().finite().nonnegative().nullable(),
  proportionDeviationRatio: z.number().finite().nonnegative().nullable(),
  paletteMeanDeltaE00: z.number().finite().nonnegative().nullable(),
  heroMaterialDeltaE00: z.number().finite().nonnegative().nullable(),
  outsideMaskChangedPixelRatio: z.number().finite().nonnegative().nullable(),
  severeDefects: z.array(z.string().min(1).max(160)).max(100),
  passedAutomatedGate: z.boolean(),
});

const generationResponseSchema = z.object({
  artifact: z.object({
    objectKey: z.string().min(1).max(1024),
    contentType: z.literal("image/png"),
    sizeBytes: z.number().int().positive().max(128 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  qualityReport: qualityReportSchema,
});

export interface HttpCharacterInferenceProviderOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMilliseconds: number;
  allowInsecureLocalhost?: boolean;
  fetch?: typeof fetch;
}

export class HttpCharacterInferenceProvider implements CharacterInferenceProvider {
  readonly key = "private-http";
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;

  constructor(private readonly options: HttpCharacterInferenceProviderOptions) {
    this.#baseUrl = normalizeBaseUrl(options.baseUrl);
    if (
      this.#baseUrl.protocol !== "https:" &&
      !(
        options.allowInsecureLocalhost === true &&
        ["localhost", "127.0.0.1", "::1"].includes(this.#baseUrl.hostname)
      )
    ) {
      throw new Error("Character inference requires HTTPS except for an explicitly allowed localhost.");
    }
    if (options.apiKey.length < 16) {
      throw new Error("Character inference API key must contain at least 16 characters.");
    }
    if (
      !Number.isSafeInteger(options.timeoutMilliseconds) ||
      options.timeoutMilliseconds < 1_000 ||
      options.timeoutMilliseconds > 15 * 60_000
    ) {
      throw new Error("Character inference timeout must be between 1 second and 15 minutes.");
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async trainIdentity(
    input: CharacterIdentityTrainingInput,
  ): Promise<CharacterIdentityTrainingResult> {
    const response = await this.post("v1/identity-models", {
      projectId: input.bible.projectId,
      bible: inferenceBible(input),
      modelVersion: {
        id: input.modelVersion.id,
        providerKey: input.modelVersion.providerKey,
        baseModelReference: input.modelVersion.baseModelReference,
        datasetFingerprint: input.modelVersion.datasetFingerprint,
        trainingConfiguration: input.modelVersion.trainingConfiguration,
      },
      references: inferenceReferences(input.references),
    }, input.modelVersion.id);
    return trainingResponseSchema.parse(response);
  }

  async generate(
    input: CharacterGenerationInput,
  ): Promise<CharacterGenerationResult> {
    const response = generationResponseSchema.parse(
      await this.post("v1/generations", {
        projectId: input.bible.projectId,
        bible: inferenceBible(input),
        modelVersion: {
          id: input.modelVersion.id,
          providerModelReference: input.modelVersion.providerModelReference,
          datasetFingerprint: input.modelVersion.datasetFingerprint,
        },
        attempt: {
          id: input.attempt.id,
          target: input.attempt.target,
          controls: input.attempt.controls,
        },
        references: inferenceReferences(input.references),
      }, input.attempt.id),
    );
    return {
      artifact: { kind: "stored-object", ...response.artifact },
      qualityReport: response.qualityReport,
    };
  }

  private async post(path: string, body: unknown, operationId: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(new URL(path, this.#baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          "x-idempotency-key": operationId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.timeoutMilliseconds),
      });
    } catch (error) {
      throw new CharacterProviderError(
        error instanceof DOMException && error.name === "TimeoutError"
          ? "CHARACTER_PROVIDER_TIMEOUT"
          : "CHARACTER_PROVIDER_UNAVAILABLE",
      );
    }
    if (!response.ok) {
      throw new CharacterProviderError(
        response.status === 429
          ? "CHARACTER_PROVIDER_RATE_LIMITED"
          : response.status >= 500
            ? "CHARACTER_PROVIDER_UNAVAILABLE"
            : "CHARACTER_PROVIDER_REJECTED",
      );
    }
    try {
      return await response.json();
    } catch {
      throw new CharacterProviderError("CHARACTER_PROVIDER_RESPONSE_INVALID");
    }
  }
}

function normalizeBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      "Character inference base URL cannot contain credentials, a query, or a fragment.",
    );
  }
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

function inferenceBible(input: CharacterIdentityTrainingInput | CharacterGenerationInput) {
  return {
    id: input.bible.id,
    version: input.bible.version,
    identityDescription: input.bible.identityDescription,
    negativeConstraints: input.bible.negativeConstraints,
    distinguishingFeatures: input.bible.distinguishingFeatures,
    proportions: input.bible.proportions,
    palette: input.bible.palette,
    materials: input.bible.materials,
  };
}

function inferenceReferences(references: CharacterIdentityTrainingInput["references"]) {
  return references.map((reference) => ({
    id: reference.id,
    role: reference.role,
    canonicalView: reference.canonicalView,
    objectKey: reference.artifact.objectKey,
    sha256: reference.artifact.sha256,
    width: reference.width,
    height: reference.height,
  }));
}
