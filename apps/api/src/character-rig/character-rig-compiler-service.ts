import type {
  CharacterArtifactReference,
  CharacterReferenceAsset,
  CharacterRigNode,
  CharacterRigVersion,
  LayerDocument,
  LayerNode,
} from "@motionprep/contracts";
import { requestFingerprint } from "../idempotency/request-fingerprint.js";
import type { LayerDocumentRepository } from "../processing/processing-repository.js";
import type { CharacterJobRepository } from "./character-job-repository.js";
import { CharacterJobService } from "./character-job-service.js";
import type { CharacterRigRepository } from "./character-rig-repository.js";

export interface QueueCharacterRigCompilationInput {
  projectId: string;
  sourceVersionId: string;
  bibleId: string;
  width: number;
  height: number;
  idempotencyKey: string;
  requestedAt: string;
}

/** Compiles source pixels only; no inference provider participates. */
export class CharacterRigCompilerService {
  readonly #jobs: CharacterJobService;

  constructor(
    private readonly repository: CharacterRigRepository,
    private readonly jobRepository: CharacterJobRepository,
    private readonly documents: LayerDocumentRepository,
  ) {
    this.#jobs = new CharacterJobService(jobRepository);
  }

  async queue(input: QueueCharacterRigCompilationInput) {
    const bible = await this.repository.findBible(input.projectId, input.bibleId);
    if (!bible || bible.status !== "approved") {
      throw new CharacterRigCompilerError("CHARACTER_BIBLE_NOT_APPROVED");
    }
    const [references, document] = await Promise.all([
      this.repository.listReferences(input.projectId, bible.id),
      this.documents.findBySource(input.projectId, input.sourceVersionId),
    ]);
    const source = selectSourceReference(references, input.sourceVersionId);
    if (!source) {
      throw new CharacterRigCompilerError("CHARACTER_SOURCE_REFERENCE_REQUIRED");
    }
    if (source.canonicalView !== "frontal") {
      throw new CharacterRigCompilerError("CHARACTER_SOURCE_MUST_BE_FRONTAL");
    }
    if (!document) {
      throw new CharacterRigCompilerError("CHARACTER_SOURCE_LAYERS_NOT_READY");
    }
    validateSourceDocument(document, input, source);

    const sourceFingerprint = fingerprintSource(document, source);
    const requestHash = requestFingerprint("character-rig-source-compilation", {
      bibleId: bible.id,
      sourceVersionId: input.sourceVersionId,
      sourceFingerprint,
    });
    const operationKey = `rig-compile:${input.idempotencyKey}`;
    const replay = await this.findReplay(
      input.projectId,
      operationKey,
      requestHash,
    );
    if (replay) return replay;
    const latest = await this.repository.findLatestRigVersion(
      input.projectId,
      bible.id,
    );
    const matching =
      latest?.pipeline === "source-preserving" &&
      latest.sourceFingerprint === sourceFingerprint &&
      latest.canvas?.width === input.width &&
      latest.canvas.height === input.height;
    if (matching && latest) {
      const existingCompile = (await this.jobRepository.listByProject(input.projectId))
        .find(
          (job) =>
            job.type === "compile-rig" &&
            job.payload.rigVersionId === latest.id,
        );
      if (
        existingCompile &&
        (latest.status !== "draft" ||
          !["failed", "cancelled"].includes(existingCompile.status))
      ) {
        return { rig: latest, job: existingCompile, replayed: true };
      }
      if (latest.status !== "draft") {
        throw new CharacterRigCompilerError("CHARACTER_RIG_JOB_MISSING");
      }
    }
    const rig = matching && latest
      ? latest
      : createSourcePreservingRig({
          projectId: input.projectId,
          bibleId: bible.id,
          version: (latest?.version ?? 0) + 1,
          source,
          document,
          sourceFingerprint,
          now: input.requestedAt,
        });
    let persistedRig = rig;
    let replayed = matching;
    if (!matching && !(await this.repository.saveRigVersion(rig))) {
      const raced = await this.repository.findLatestRigVersion(
        input.projectId,
        bible.id,
      );
      if (
        raced?.pipeline !== "source-preserving" ||
        raced.sourceFingerprint !== sourceFingerprint ||
        raced.canvas?.width !== input.width ||
        raced.canvas.height !== input.height
      ) {
        throw new CharacterRigCompilerError("CHARACTER_RIG_VERSION_CONFLICT");
      }
      persistedRig = raced;
      replayed = true;
    }
    const job = await this.#jobs.enqueue({
      projectId: input.projectId,
      type: "compile-rig",
      operationKey,
      requestHash,
      payload: {
        rigVersionId: persistedRig.id,
        width: input.width,
        height: input.height,
      },
      now: input.requestedAt,
      maxAttempts: 2,
    });
    return { rig: persistedRig, job, replayed };
  }

  private async findReplay(
    projectId: string,
    operationKey: string,
    requestHash: string,
  ) {
    const job = await this.jobRepository.findByOperationKey(
      projectId,
      operationKey,
    );
    if (!job) return null;
    if (job.requestHash !== requestHash) {
      throw new CharacterRigCompilerError("CHARACTER_JOB_IDEMPOTENCY_CONFLICT");
    }
    const rigVersionId = job.payload.rigVersionId;
    if (typeof rigVersionId !== "string") {
      throw new CharacterRigCompilerError("CHARACTER_RIG_JOB_INVALID");
    }
    const rig = await this.repository.findRigVersion(projectId, rigVersionId);
    if (!rig) {
      throw new CharacterRigCompilerError("CHARACTER_RIG_NOT_FOUND");
    }
    return { rig, job, replayed: true };
  }
}

export class CharacterRigCompilerError extends Error {
  constructor(
    readonly code: string,
    readonly missingParts: string[] = [],
  ) {
    super(code);
  }
}

function selectSourceReference(
  references: readonly CharacterReferenceAsset[],
  sourceVersionId: string,
): CharacterReferenceAsset | undefined {
  return references.find(
    (reference) =>
      reference.role === "identity-primary" &&
      reference.sourceVersionId === sourceVersionId,
  );
}

function validateSourceDocument(
  document: LayerDocument,
  input: QueueCharacterRigCompilationInput,
  source: CharacterReferenceAsset,
): void {
  if (
    document.sourceVersionId !== input.sourceVersionId ||
    document.width !== input.width ||
    document.height !== input.height ||
    source.width !== input.width ||
    source.height !== input.height
  ) {
    throw new CharacterRigCompilerError("CHARACTER_SOURCE_CANVAS_MISMATCH");
  }
  if (!Number.isSafeInteger(document.revision) || (document.revision ?? 0) < 1) {
    throw new CharacterRigCompilerError("CHARACTER_SOURCE_REVISION_INVALID");
  }
  if (document.layers.length === 0) {
    throw new CharacterRigCompilerError("CHARACTER_SOURCE_LAYERS_EMPTY");
  }
  const ids = new Set(document.layers.map((layer) => layer.id));
  let rasterCount = 0;
  for (const layer of document.layers) {
    if (layer.kind === "text") {
      throw new CharacterRigCompilerError("CHARACTER_SOURCE_LAYER_KIND_UNSUPPORTED");
    }
    if (layer.parentId && !ids.has(layer.parentId)) {
      throw new CharacterRigCompilerError("CHARACTER_SOURCE_LAYER_PARENT_INVALID");
    }
    if (layer.kind !== "raster") continue;
    rasterCount += 1;
    if (!layer.rasterAsset || !validBounds(layer, document.width, document.height)) {
      throw new CharacterRigCompilerError("CHARACTER_SOURCE_LAYER_INVALID");
    }
  }
  if (rasterCount === 0) {
    throw new CharacterRigCompilerError("CHARACTER_SOURCE_RASTER_REQUIRED");
  }
}

function fingerprintSource(
  document: LayerDocument,
  source: CharacterReferenceAsset,
): string {
  return requestFingerprint("character-rig-source-layers", {
    sourceVersionId: document.sourceVersionId,
    sourceSha256: source.artifact.sha256,
    revision: document.revision,
    width: document.width,
    height: document.height,
    layers: document.layers.map((layer) => ({
      id: layer.id,
      parentId: layer.parentId,
      kind: layer.kind,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      zIndex: layer.zIndex,
      bounds: layer.bounds,
      rasterSha256: layer.rasterAsset?.sha256 ?? null,
    })),
  });
}

function createSourcePreservingRig(input: {
  projectId: string;
  bibleId: string;
  version: number;
  source: CharacterReferenceAsset;
  document: LayerDocument;
  sourceFingerprint: string;
  now: string;
}): CharacterRigVersion {
  const rootId = crypto.randomUUID();
  const frontalId = crypto.randomUUID();
  const nodes: CharacterRigNode[] = [
    groupNode(rootId, null, "+Character", null, "character-root", 0),
    groupNode(frontalId, rootId, "+Frontal", "frontal", "view", 0),
    ...input.document.layers.map((layer) =>
      sourceLayerNode(layer, frontalId, input.now),
    ),
  ];
  return {
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    projectId: input.projectId,
    bibleId: input.bibleId,
    version: input.version,
    status: "draft",
    pipeline: "source-preserving",
    failureCode: null,
    sourceFingerprint: input.sourceFingerprint,
    source: {
      sourceVersionId: input.source.sourceVersionId,
      referenceId: input.source.id,
      artifact: structuredClone(input.source.artifact),
      layerDocumentRevision: input.document.revision!,
      pixelIdentityRequired: true,
    },
    canvas: { width: input.document.width, height: input.document.height },
    nodes,
    psdArtifact: null,
    manifestArtifact: null,
    approvedByUserId: null,
    approvedAt: null,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function sourceLayerNode(
  layer: LayerNode,
  frontalId: string,
  createdAt: string,
): CharacterRigNode {
  const artifact: CharacterArtifactReference | null = layer.rasterAsset
    ? {
        ...structuredClone(layer.rasterAsset),
        createdAt,
        retentionExpiresAt: null,
      }
    : null;
  return {
    id: layer.id,
    parentId: layer.parentId ?? frontalId,
    kind: layer.kind === "raster" ? "raster" : "group",
    name: layer.name,
    canonicalView: "frontal",
    semanticPart: null,
    sourceLayerId: layer.id,
    artifact,
    bounds: layer.bounds ? structuredClone(layer.bounds) : null,
    visible: layer.visible,
    locked: layer.locked || layer.fixed,
    opacity: layer.opacity,
    zIndex: layer.zIndex,
  };
}

function validBounds(layer: LayerNode, width: number, height: number): boolean {
  const bounds = layer.bounds;
  return Boolean(
    bounds &&
      Number.isSafeInteger(bounds.x) &&
      Number.isSafeInteger(bounds.y) &&
      Number.isSafeInteger(bounds.width) &&
      Number.isSafeInteger(bounds.height) &&
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.x + bounds.width <= width &&
      bounds.y + bounds.height <= height,
  );
}

function groupNode(
  id: string,
  parentId: string | null,
  name: `+${string}`,
  canonicalView: "frontal" | null,
  semanticPart: string,
  zIndex: number,
): CharacterRigNode {
  return {
    id,
    parentId,
    kind: "group",
    name,
    canonicalView,
    semanticPart,
    sourceLayerId: null,
    artifact: null,
    bounds: null,
    visible: true,
    locked: false,
    opacity: 1,
    zIndex,
  };
}
