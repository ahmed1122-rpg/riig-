import { z } from "zod";
import type {
  CharacterGenerationInput,
  CharacterGenerationResult,
  CharacterIdentityTrainingInput,
  CharacterIdentityTrainingResult,
  CharacterInferenceProvider,
} from "./character-inference-provider.js";
import { CharacterProviderError } from "./character-inference-provider.js";
import {
  abortableDelay,
  normalizeCharacterProviderBaseUrl,
  parseProviderJson,
  parseRetryAfterMilliseconds,
} from "./http-character-inference-provider-support.js";

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
  geometry: z.object({
    canvas: z.object({
      width: z.number().int().positive().max(10_000),
      height: z.number().int().positive().max(10_000),
    }),
    bounds: z.object({
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      width: z.number().int().positive().max(10_000),
      height: z.number().int().positive().max(10_000),
    }),
  }),
  qualityReport: qualityReportSchema,
});

const asyncSubmissionSchema = z.object({
  operationId: z.string().min(1).max(200),
  statusUrl: z.string().min(1).max(2_048),
  retryAfterMilliseconds: z.number().int().min(0).max(60_000).optional(),
});

const asyncPendingSchema = z.object({
  status: z.enum(["queued", "running"]),
  retryAfterMilliseconds: z.number().int().min(0).max(60_000).optional(),
});

const asyncSucceededSchema = z.object({
  status: z.literal("succeeded"),
  result: z.unknown(),
});

const asyncFailedSchema = z.object({
  status: z.literal("failed"),
  errorCode: z.enum([
    "CAPACITY_EXHAUSTED",
    "INPUT_REJECTED",
    "MODEL_REJECTED",
    "OPERATION_EXPIRED",
    "PROVIDER_INTERNAL",
  ]),
});

export type CharacterInferenceProtocol = "direct-v1" | "async-v1";

export interface CharacterProviderOperationEvent {
  phase: "submitted" | "poll" | "completed";
  status: "accepted" | "queued" | "running" | "succeeded";
  pollCount: number;
  durationMilliseconds: number;
  retryAfterMilliseconds?: number;
}

export interface HttpCharacterInferenceProviderOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMilliseconds: number;
  protocol?: CharacterInferenceProtocol;
  operationTimeoutMilliseconds?: number;
  pollIntervalMilliseconds?: number;
  maxPollIntervalMilliseconds?: number;
  allowInsecureLocalhost?: boolean;
  fetch?: typeof fetch;
  delay?: typeof abortableDelay;
  onOperationEvent?: (event: CharacterProviderOperationEvent) => void;
}

export class HttpCharacterInferenceProvider implements CharacterInferenceProvider {
  readonly key = "private-http";
  readonly #baseUrl: URL;
  readonly #fetch: typeof fetch;
  readonly #protocol: CharacterInferenceProtocol;
  readonly #operationTimeoutMilliseconds: number;
  readonly #pollIntervalMilliseconds: number;
  readonly #maxPollIntervalMilliseconds: number;
  readonly #delay: typeof abortableDelay;

  constructor(private readonly options: HttpCharacterInferenceProviderOptions) {
    this.#baseUrl = normalizeCharacterProviderBaseUrl(options.baseUrl);
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
    this.#protocol = options.protocol ?? "direct-v1";
    this.#operationTimeoutMilliseconds =
      options.operationTimeoutMilliseconds ?? options.timeoutMilliseconds;
    if (
      !Number.isSafeInteger(this.#operationTimeoutMilliseconds) ||
      this.#operationTimeoutMilliseconds < options.timeoutMilliseconds ||
      this.#operationTimeoutMilliseconds > 30 * 60_000
    ) {
      throw new Error(
        "Character inference operation timeout must be at least the request timeout and no more than 30 minutes.",
      );
    }
    this.#pollIntervalMilliseconds = options.pollIntervalMilliseconds ?? 1_000;
    this.#maxPollIntervalMilliseconds =
      options.maxPollIntervalMilliseconds ?? 10_000;
    if (
      !Number.isSafeInteger(this.#pollIntervalMilliseconds) ||
      this.#pollIntervalMilliseconds < 250 ||
      this.#pollIntervalMilliseconds > 30_000
    ) {
      throw new Error(
        "Character inference poll interval must be between 250 milliseconds and 30 seconds.",
      );
    }
    if (
      !Number.isSafeInteger(this.#maxPollIntervalMilliseconds) ||
      this.#maxPollIntervalMilliseconds < this.#pollIntervalMilliseconds ||
      this.#maxPollIntervalMilliseconds > 60_000
    ) {
      throw new Error(
        "Character inference maximum poll interval must be between the initial interval and 60 seconds.",
      );
    }
    this.#fetch = options.fetch ?? globalThis.fetch;
    this.#delay = options.delay ?? abortableDelay;
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
    }, input.modelVersion.id, input.signal);
    const parsed = trainingResponseSchema.safeParse(response);
    if (!parsed.success) {
      throw new CharacterProviderError("CHARACTER_PROVIDER_RESPONSE_INVALID");
    }
    return parsed.data;
  }

  async generate(
    input: CharacterGenerationInput,
  ): Promise<CharacterGenerationResult> {
    const parsed = generationResponseSchema.safeParse(
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
          canvas: input.attempt.controls.canvas,
        },
        outputObjectKey: input.outputObjectKey,
        references: inferenceReferences(input.references),
      }, input.attempt.id, input.signal),
    );
    if (!parsed.success || !validGeometry(parsed.data.geometry, input.attempt.controls.canvas)) {
      throw new CharacterProviderError("CHARACTER_PROVIDER_RESPONSE_INVALID");
    }
    const response = parsed.data;
    return {
      artifact: { kind: "stored-object", ...response.artifact },
      geometry: response.geometry,
      qualityReport: response.qualityReport,
    };
  }

  private async post(
    path: string,
    body: unknown,
    operationId: string,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const operationTimeoutSignal = AbortSignal.timeout(
      this.#operationTimeoutMilliseconds,
    );
    const operationSignal = signal
      ? AbortSignal.any([signal, operationTimeoutSignal])
      : operationTimeoutSignal;
    const startedAt = performance.now();
    const response = await this.request(
      "POST",
      new URL(path, this.#baseUrl),
      operationId,
      operationSignal,
      body,
      signal,
      operationTimeoutSignal,
    );
    if (this.#protocol === "direct-v1") {
      return parseProviderJson(response);
    }
    if (response.status !== 202) {
      throw new CharacterProviderError("CHARACTER_PROVIDER_RESPONSE_INVALID");
    }
    const submission = asyncSubmissionSchema.safeParse(
      await parseProviderJson(response),
    );
    if (!submission.success) {
      throw new CharacterProviderError("CHARACTER_PROVIDER_RESPONSE_INVALID");
    }
    const statusUrl = this.resolveStatusUrl(submission.data.statusUrl);
    let pollCount = 0;
    let pollDelay = this.nextPollDelay(
      response,
      submission.data.retryAfterMilliseconds,
      this.#pollIntervalMilliseconds,
    );
    this.emitOperationEvent({
      phase: "submitted",
      status: "accepted",
      pollCount,
      durationMilliseconds: Math.round(performance.now() - startedAt),
      retryAfterMilliseconds: pollDelay,
    });

    while (true) {
      try {
        await this.#delay(pollDelay, operationSignal);
      } catch {
        throw new CharacterProviderError(
          signal?.aborted
            ? "CHARACTER_JOB_ABORTED"
            : "CHARACTER_PROVIDER_TIMEOUT",
        );
      }
      const pollResponse = await this.request(
        "GET",
        statusUrl,
        operationId,
        operationSignal,
        undefined,
        signal,
        operationTimeoutSignal,
      );
      pollCount += 1;
      const statusBody = await parseProviderJson(pollResponse);
      const pending = asyncPendingSchema.safeParse(statusBody);
      if (pollResponse.status === 202 && pending.success) {
        pollDelay = this.nextPollDelay(
          pollResponse,
          pending.data.retryAfterMilliseconds,
          Math.min(
            this.#maxPollIntervalMilliseconds,
            Math.ceil(pollDelay * 1.5),
          ),
        );
        this.emitOperationEvent({
          phase: "poll",
          status: pending.data.status,
          pollCount,
          durationMilliseconds: Math.round(performance.now() - startedAt),
          retryAfterMilliseconds: pollDelay,
        });
        continue;
      }
      const succeeded = asyncSucceededSchema.safeParse(statusBody);
      if (pollResponse.status === 200 && succeeded.success) {
        this.emitOperationEvent({
          phase: "completed",
          status: "succeeded",
          pollCount,
          durationMilliseconds: Math.round(performance.now() - startedAt),
        });
        return succeeded.data.result;
      }
      const failed = asyncFailedSchema.safeParse(statusBody);
      if (pollResponse.status === 200 && failed.success) {
        throw new CharacterProviderError(
          mapAsyncFailureCode(failed.data.errorCode),
        );
      }
      throw new CharacterProviderError("CHARACTER_PROVIDER_RESPONSE_INVALID");
    }
  }

  private async request(
    method: "GET" | "POST",
    url: URL,
    operationId: string,
    operationSignal: AbortSignal,
    body: unknown,
    callerSignal: AbortSignal | undefined,
    operationTimeoutSignal: AbortSignal,
  ): Promise<Response> {
    let response: Response;
    try {
      const requestTimeoutSignal = AbortSignal.timeout(
        this.options.timeoutMilliseconds,
      );
      response = await this.#fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          accept: "application/json",
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
          "x-idempotency-key": operationId,
          "x-motionprep-protocol-version": "1",
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.any([operationSignal, requestTimeoutSignal]),
      });
    } catch (error) {
      throw new CharacterProviderError(
        callerSignal?.aborted
          ? "CHARACTER_JOB_ABORTED"
          : operationTimeoutSignal.aborted ||
              (error instanceof DOMException && error.name === "TimeoutError")
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
    return response;
  }

  private resolveStatusUrl(value: string): URL {
    let statusUrl: URL;
    try {
      statusUrl = new URL(value, this.#baseUrl);
    } catch {
      throw new CharacterProviderError("CHARACTER_PROVIDER_RESPONSE_INVALID");
    }
    if (
      statusUrl.origin !== this.#baseUrl.origin ||
      !statusUrl.pathname.startsWith(this.#baseUrl.pathname) ||
      statusUrl.username ||
      statusUrl.password ||
      statusUrl.search ||
      statusUrl.hash
    ) {
      throw new CharacterProviderError("CHARACTER_PROVIDER_STATUS_URL_INVALID");
    }
    return statusUrl;
  }

  private nextPollDelay(
    response: Response,
    bodyDelay: number | undefined,
    fallback: number,
  ): number {
    const retryAfter = parseRetryAfterMilliseconds(response.headers.get("retry-after"));
    return Math.min(
      this.#maxPollIntervalMilliseconds,
      Math.max(
        this.#pollIntervalMilliseconds,
        retryAfter ?? bodyDelay ?? fallback,
      ),
    );
  }

  private emitOperationEvent(event: CharacterProviderOperationEvent): void {
    try {
      this.options.onOperationEvent?.(event);
    } catch {
      // Observability must never change provider settlement behavior.
    }
  }
}

function mapAsyncFailureCode(code: z.infer<typeof asyncFailedSchema>["errorCode"]): string {
  if (code === "CAPACITY_EXHAUSTED") return "CHARACTER_PROVIDER_RATE_LIMITED";
  if (code === "PROVIDER_INTERNAL") return "CHARACTER_PROVIDER_UNAVAILABLE";
  return "CHARACTER_PROVIDER_REJECTED";
}

function validGeometry(
  geometry: z.infer<typeof generationResponseSchema>["geometry"],
  requestedCanvas: { width: number; height: number },
): boolean {
  return (
    geometry.canvas.width === requestedCanvas.width &&
    geometry.canvas.height === requestedCanvas.height &&
    geometry.bounds.x + geometry.bounds.width <= geometry.canvas.width &&
    geometry.bounds.y + geometry.bounds.height <= geometry.canvas.height
  );
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
