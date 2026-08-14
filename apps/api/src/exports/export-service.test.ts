import type {
  ExportJob,
  ExportRequest,
  LayerDocument,
  LayerNode,
} from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "../idempotency/idempotency-store.js";
import { InMemoryLayerDocumentRepository } from "../processing/processing-repository.js";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import { exportArtifactGenerationKey } from "./export-artifact-reader.js";
import { InMemoryExportRepository } from "./export-repository.js";
import { ExportService } from "./export-service.js";

const timestamp = "2026-07-28T10:00:00.000Z";

describe("ExportService worker execution", () => {
  it("does not retain a job when the project fence activation fails", async () => {
    const repository = new InMemoryExportRepository();
    const storage = new InMemoryObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = { ...createBookDocument(), revision: 1 };
    await documents.save(document);
    const service = createWorkerService(repository, storage, documents);

    await expect(
      service.create(
        { ...createRequest(document, "txt"), documentRevision: 1 },
        "book",
        "failed-project-fence",
        async () => false,
      ),
    ).rejects.toMatchObject({ code: "EXPORT_SOURCE_NOT_CURRENT" });
    await expect(repository.list(200)).resolves.toHaveLength(0);
  });

  it("does not mutate an existing job when a generated export id collides", async () => {
    const repository = new CollidingExportRepository();
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    await documents.save(document);
    const service = createWorkerService(
      repository,
      new InMemoryObjectStorage(),
      documents,
    );

    await expect(
      service.create(
        createRequest(document, "txt"),
        "book",
        "forced-export-id-collision",
      ),
    ).rejects.toMatchObject({ code: "EXPORT_SOURCE_NOT_CURRENT" });

    expect(repository.collidingJob).not.toBeNull();
    await expect(
      repository.findById(repository.collidingJob!.id),
    ).resolves.toEqual(repository.collidingJob);
    expect(repository.collidingJob).toMatchObject({ status: "queued" });
  });

  it("rejects an export requested from a stale layer-document revision", async () => {
    const repository = new InMemoryExportRepository();
    const storage = new InMemoryObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = { ...createBookDocument(), revision: 4 };
    await documents.save(document);
    const service = createWorkerService(repository, storage, documents);

    await expect(
      service.create(
        { ...createRequest(document, "txt"), documentRevision: 3 },
        "book",
        "stale-document-revision",
      ),
    ).rejects.toMatchObject({
      code: "EXPORT_DOCUMENT_REVISION_CONFLICT",
    });
    await expect(repository.list(200)).resolves.toHaveLength(0);
  });

  it("exports the pinned layer-document revision when a newer revision exists", async () => {
    const repository = new InMemoryExportRepository();
    const storage = new InMemoryObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = { ...createBookDocument("pinned revision"), revision: 2 };
    await documents.save(document);
    const service = createWorkerService(repository, storage, documents);
    const queued = await service.create(
      { ...createRequest(document, "txt"), documentRevision: 2 },
      "book",
      "document-changed-before-worker",
    );
    await documents.save({
      ...document,
      revision: 3,
      layers: document.layers.map((layer) =>
        layer.kind === "text"
          ? { ...layer, fullText: "newer revision", name: "+newer_revision" }
          : layer,
      ),
    });

    const ready = await service.claimAndProcess(
      "export-worker-revision",
      60_000,
    );
    expect(ready).toMatchObject({
      id: queued.id,
      status: "ready",
      documentRevision: 2,
    });
    expect((await service.artifact(queued.id)).body.toString("utf8")).toContain(
      "pinned revision",
    );
    expect((await service.artifact(queued.id)).body.toString("utf8")).not.toContain(
      "newer revision",
    );
  });

  it("claims a queued text export, persists its artifact, and serves it", async () => {
    const repository = new InMemoryExportRepository();
    const storage = new InMemoryObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    await documents.save(document);
    const service = createWorkerService(repository, storage, documents);
    const queued = await service.create(
      createRequest(document, "txt"),
      "book",
      "worker-text-export",
    );

    expect(queued).toMatchObject({ status: "queued", attempt: 0 });
    const ready = await service.claimAndProcess("export-worker-1", 60_000);
    expect(ready).toMatchObject({
      id: queued.id,
      status: "ready",
      progress: 100,
      attempt: 1,
      leaseOwner: null,
      leaseExpiresAt: null,
      errorCode: null,
      artifact: {
        filename: `motionprep-${document.projectId}.txt`,
      },
    });
    expect(ready?.artifact?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(ready?.artifact?.objectKey).toMatch(
      /^artifacts\/[^/]+\/[^/]+\/generations\/[^/]+\/[^/]+$/u,
    );

    const artifact = await service.artifact(queued.id);
    expect(artifact.contentType).toBe("text/plain; charset=utf-8");
    expect(artifact.body.toString("utf8")).toContain("الفصل الأول");
    const streamedArtifact = await service.artifactStream(queued.id);
    const chunks: Buffer[] = [];
    for await (const chunk of streamedArtifact.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks).toString("utf8")).toBe(
      artifact.body.toString("utf8"),
    );
    expect(await service.listByProjectIds([document.projectId])).toHaveLength(
      1,
    );
  });

  it("marks a claimed job failed when its layer document is absent", async () => {
    const repository = new InMemoryExportRepository();
    const service = createWorkerService(
      repository,
      new InMemoryObjectStorage(),
      new InMemoryLayerDocumentRepository(),
    );
    const document = createBookDocument();
    const queued = await service.create(
      createRequest(document, "json"),
      "book",
      "missing-document-export",
    );

    expect(await service.claimAndProcess("export-worker-2", 60_000)).toMatchObject(
      {
        id: queued.id,
        status: "failed",
        errorCode: "EXPORT_DOCUMENT_NOT_READY",
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    );
  });

  it("requeues an infrastructure failure with bounded backoff", async () => {
    const repository = new InMemoryExportRepository();
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    await documents.save(document);
    const service = new ExportService(
      repository,
      () => new Date(timestamp),
      new InMemoryIdempotencyStore(),
      undefined,
      undefined,
      documents,
      false,
    );
    const queued = await service.create(
      createRequest(document, "json"),
      "book",
      "storage-failure-export",
    );

    expect(await service.claimAndProcess("export-worker-3", 60_000)).toMatchObject(
      {
        id: queued.id,
        status: "queued",
        attempt: 1,
        errorCode: "EXPORT_WORKER_FAILED",
        nextAttemptAt: "2026-07-28T10:00:02.000Z",
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    );
  });

  it("returns null when no queued job is available", async () => {
    const service = createWorkerService(
      new InMemoryExportRepository(),
      new InMemoryObjectStorage(),
      new InMemoryLayerDocumentRepository(),
    );

    await expect(
      service.claimAndProcess("export-worker-idle", 60_000),
    ).resolves.toBeNull();
  });

  it.each(["csv", "json"] as const)(
    "generates a %s text artifact inline and reuses its idempotency claim",
    async (format) => {
      const repository = new InMemoryExportRepository();
      const storage = new InMemoryObjectStorage();
      const documents = new InMemoryLayerDocumentRepository();
      const document = createBookDocument('"الفصل, الأول"');
      await documents.save(document);
      const service = new ExportService(
        repository,
        () => new Date(timestamp),
        new InMemoryIdempotencyStore(),
        undefined,
        storage,
        documents,
        true,
      );
      const request = createRequest(document, format);
      const ready = await service.create(
        request,
        "book",
        `inline-${format}-export`,
      );
      const repeated = await service.create(
        request,
        "book",
        `inline-${format}-export`,
      );
      const artifact = await service.artifact(ready.id);

      expect(ready.status).toBe("ready");
      expect(repeated.id).toBe(ready.id);
      if (format === "csv") {
        expect(artifact.contentType).toBe("text/csv; charset=utf-8");
        expect(artifact.body.toString("utf8")).toContain("text_align");
        expect(artifact.body.toString("utf8")).toContain("justify");
        expect(artifact.body.toString("utf8")).toContain(
          ',+الفصل_الأول,"""الفصل, الأول"""',
        );
      } else {
        expect(artifact.contentType).toBe("application/json");
        expect(JSON.parse(artifact.body.toString("utf8"))).toMatchObject({
          projectId: document.projectId,
          sourceVersionId: document.sourceVersionId,
        });
      }
    },
  );

  it("rejects reuse of an idempotency key for a different export request", async () => {
    const repository = new InMemoryExportRepository();
    const storage = new InMemoryObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    await documents.save(document);
    const service = new ExportService(
      repository,
      () => new Date(timestamp),
      new InMemoryIdempotencyStore(),
      undefined,
      storage,
      documents,
      true,
    );

    await service.create(
      createRequest(document, "txt"),
      "book",
      "conflicting-export-request",
    );

    await expect(
      service.create(
        createRequest(document, "json"),
        "book",
        "conflicting-export-request",
      ),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(repository.list(200)).resolves.toHaveLength(1);
  });

  it("rejects artifact access before generation and unknown jobs", async () => {
    const repository = new InMemoryExportRepository();
    const document = createBookDocument();
    const service = createWorkerService(
      repository,
      new InMemoryObjectStorage(),
      new InMemoryLayerDocumentRepository(),
    );
    const queued = await service.create(
      createRequest(document, "txt"),
      "book",
      "not-ready-artifact",
    );

    await expect(service.artifact(queued.id)).rejects.toMatchObject({
      code: "EXPORT_ARTIFACT_NOT_READY",
    });
    await expect(service.find(crypto.randomUUID())).rejects.toMatchObject({
      code: "EXPORT_NOT_FOUND",
    });
  });

  it("rejects a cloud artifact whose bytes no longer match its saved hash", async () => {
    const repository = new InMemoryExportRepository();
    const storage = new InMemoryObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    await documents.save(document);
    const service = new ExportService(
      repository,
      () => new Date(timestamp),
      new InMemoryIdempotencyStore(),
      undefined,
      storage,
      documents,
      true,
    );
    const ready = await service.create(
      createRequest(document, "txt"),
      "book",
      "tampered-artifact",
    );
    const artifactKey = ready.artifact!.objectKey!;
    const tampered = Buffer.from("tampered cloud artifact");
    await storage.put({
      key: artifactKey,
      contentType: "text/plain; charset=utf-8",
      sizeBytes: tampered.byteLength,
      body: tampered,
    });

    await expect(service.artifact(ready.id)).rejects.toMatchObject({
      code: "EXPORT_ARTIFACT_INTEGRITY_FAILED",
    });
  });

  it("reads historical artifacts that predate persisted object keys", async () => {
    const repository = new InMemoryExportRepository();
    const storage = new InMemoryObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    await documents.save(document);
    const service = new ExportService(
      repository,
      () => new Date(timestamp),
      new InMemoryIdempotencyStore(),
      undefined,
      storage,
      documents,
      true,
    );
    const ready = await service.create(
      createRequest(document, "txt"),
      "book",
      "legacy-artifact-location",
    );
    const generatedKey = ready.artifact!.objectKey!;
    const generatedObject = (await storage.get(generatedKey))!;
    const legacyKey = `artifacts/${ready.projectId}/${ready.id}/${ready.artifact!.filename}`;
    await storage.put({ ...generatedObject, key: legacyKey });
    await storage.delete(generatedKey);
    const { objectKey: _objectKey, ...legacyArtifact } = ready.artifact!;
    await repository.save({ ...ready, artifact: legacyArtifact });

    await expect(service.artifact(ready.id)).resolves.toMatchObject({
      key: legacyKey,
      body: generatedObject.body,
    });
  });

  it("removes only a lost attempt while preserving a concurrently finalized generation", async () => {
    const storage = new InMemoryObjectStorage();
    const repository = new ConcurrentFinalizationRepository(storage);
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    await documents.save(document);
    const service = createWorkerService(repository, storage, documents);
    const queued = await service.create(
      createRequest(document, "txt"),
      "book",
      "lease-race-artifact",
    );

    const completed = await service.claimAndProcess("old-worker", 60_000);

    expect(completed).toMatchObject({
      id: queued.id,
      status: "ready",
      artifact: { objectKey: repository.winnerObjectKey },
    });
    await expect(storage.inspect(repository.lostObjectKey!)).resolves.toBeNull();
    await expect(storage.inspect(repository.winnerObjectKey!)).resolves.not.toBeNull();
    await expect(service.artifact(queued.id)).resolves.toMatchObject({
      key: repository.winnerObjectKey,
    });
  });

  it("reports a lost-attempt cleanup failure without replacing the winning export", async () => {
    const storage = new FailingDeleteObjectStorage();
    const repository = new ConcurrentFinalizationRepository(storage);
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    const cleanupErrors: Array<{ error: unknown; objectKey: string }> = [];
    await documents.save(document);
    const service = new ExportService(
      repository,
      () => new Date(timestamp),
      new InMemoryIdempotencyStore(),
      undefined,
      storage,
      documents,
      false,
      (error, objectKey) => cleanupErrors.push({ error, objectKey }),
    );
    const queued = await service.create(
      createRequest(document, "txt"),
      "book",
      "lease-race-cleanup-failure",
    );

    const completed = await service.claimAndProcess("old-worker", 60_000);

    expect(completed).toMatchObject({
      id: queued.id,
      status: "ready",
      artifact: { objectKey: repository.winnerObjectKey },
    });
    expect(cleanupErrors).toEqual([
      {
        error: expect.objectContaining({ message: "storage purge unavailable" }),
        objectKey: repository.lostObjectKey,
      },
    ]);
    await expect(storage.inspect(repository.winnerObjectKey!)).resolves.not.toBeNull();
  });

  it("keeps an artifact when finalization committed before the database client rejected", async () => {
    const repository = new CommitThenRejectRepository();
    const storage = new InMemoryObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    await documents.save(document);
    const service = createWorkerService(repository, storage, documents);
    const queued = await service.create(
      createRequest(document, "txt"),
      "book",
      "ambiguous-finalization",
    );

    const completed = await service.claimAndProcess("export-worker", 60_000);

    expect(completed).toMatchObject({ id: queued.id, status: "ready" });
    await expect(storage.inspect(completed!.artifact!.objectKey!)).resolves.not.toBeNull();
    await expect(service.artifact(queued.id)).resolves.toMatchObject({
      key: completed!.artifact!.objectKey,
    });
  });

  it("denies and removes an artifact after its retention window expires", async () => {
    const repository = new InMemoryExportRepository();
    const storage = new InMemoryObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    await documents.save(document);
    let currentTime = new Date(timestamp);
    const service = new ExportService(
      repository,
      () => currentTime,
      new InMemoryIdempotencyStore(),
      undefined,
      storage,
      documents,
      true,
    );
    const ready = await service.create(
      createRequest(document, "txt"),
      "book",
      "expired-artifact",
    );
    const artifactKey = ready.artifact!.objectKey!;
    currentTime = new Date(Date.parse(timestamp) + 24 * 60 * 60_000 + 1);

    await expect(service.artifact(ready.id)).rejects.toMatchObject({
      code: "EXPORT_ARTIFACT_NOT_READY",
    });
    await expect(storage.get(artifactKey)).resolves.toBeNull();
  });

  it("reports expired-artifact cleanup failures without allowing the download", async () => {
    const repository = new InMemoryExportRepository();
    const storage = new FailingDeleteObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    const cleanupKeys: string[] = [];
    await documents.save(document);
    let currentTime = new Date(timestamp);
    const service = new ExportService(
      repository,
      () => currentTime,
      new InMemoryIdempotencyStore(),
      undefined,
      storage,
      documents,
      true,
      (_error, objectKey) => {
        cleanupKeys.push(objectKey);
        throw new Error("observer unavailable");
      },
    );
    const ready = await service.create(
      createRequest(document, "txt"),
      "book",
      "expired-cleanup-failure",
    );
    currentTime = new Date(Date.parse(timestamp) + 24 * 60 * 60_000 + 1);

    await expect(service.artifact(ready.id)).rejects.toMatchObject({
      code: "EXPORT_ARTIFACT_NOT_READY",
    });
    expect(cleanupKeys).toEqual([ready.artifact!.objectKey]);
  });

  it("marks an inline export failed and releases its claim after infrastructure failure", async () => {
    const repository = new InMemoryExportRepository();
    const documents = new InMemoryLayerDocumentRepository();
    const document = createBookDocument();
    await documents.save(document);
    const service = new ExportService(
      repository,
      () => new Date(timestamp),
      new InMemoryIdempotencyStore(),
      undefined,
      undefined,
      documents,
      true,
    );

    await expect(
      service.create(
        createRequest(document, "json"),
        "book",
        "inline-storage-failure",
      ),
    ).rejects.toThrow(/Object storage/u);
    expect(await repository.list(200)).toEqual([
      expect.objectContaining({
        status: "failed",
        errorCode: "EXPORT_WORKER_FAILED",
      }),
    ]);
  });
});

class CollidingExportRepository extends InMemoryExportRepository {
  collidingJob: ExportJob | null = null;

  override async enqueue(job: ExportJob): Promise<boolean> {
    this.collidingJob = {
      ...job,
      projectId: crypto.randomUUID(),
      sourceVersionId: crypto.randomUUID(),
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    await this.save(this.collidingJob);
    return false;
  }
}

class ConcurrentFinalizationRepository extends InMemoryExportRepository {
  lostObjectKey: string | undefined;
  winnerObjectKey: string | undefined;

  constructor(private readonly storage: InMemoryObjectStorage) {
    super();
  }

  override async updateClaim(
    id: string,
    workerId: string,
    changes: Partial<ExportJob>,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    if (changes.status !== "ready" || !changes.artifact?.objectKey) {
      return super.updateClaim(id, workerId, changes, updatedAt);
    }

    const current = await this.findById(id);
    if (!current) return null;
    this.lostObjectKey = changes.artifact.objectKey;
    const winnerBody = Buffer.from("concurrently finalized generation");
    const winnerObjectKey = exportArtifactGenerationKey(
      current,
      crypto.randomUUID(),
      changes.artifact.filename,
    );
    const winnerMetadata = await this.storage.put({
      key: winnerObjectKey,
      contentType: "text/plain; charset=utf-8",
      sizeBytes: winnerBody.byteLength,
      body: winnerBody,
    });
    this.winnerObjectKey = winnerObjectKey;
    await this.save({
      ...current,
      ...changes,
      status: "ready",
      progress: 100,
      leaseOwner: null,
      leaseExpiresAt: null,
      artifact: {
        ...changes.artifact,
        objectKey: winnerObjectKey,
        sizeBytes: winnerMetadata.sizeBytes,
        sha256: winnerMetadata.sha256,
      },
      updatedAt,
    });
    return null;
  }
}

class CommitThenRejectRepository extends InMemoryExportRepository {
  #rejectedFinalization = false;

  override async updateClaim(
    id: string,
    workerId: string,
    changes: Partial<ExportJob>,
    updatedAt: string,
  ): Promise<ExportJob | null> {
    const persisted = await super.updateClaim(id, workerId, changes, updatedAt);
    if (
      changes.status === "ready" &&
      persisted &&
      !this.#rejectedFinalization
    ) {
      this.#rejectedFinalization = true;
      throw new Error("database client rejected after finalization commit");
    }
    return persisted;
  }
}

class FailingDeleteObjectStorage extends InMemoryObjectStorage {
  override async delete(): Promise<void> {
    throw new Error("storage delete unavailable");
  }

  override async purge(): Promise<void> {
    throw new Error("storage purge unavailable");
  }
}

function createWorkerService(
  repository: InMemoryExportRepository,
  storage: InMemoryObjectStorage,
  documents: InMemoryLayerDocumentRepository,
): ExportService {
  return new ExportService(
    repository,
    () => new Date(timestamp),
    new InMemoryIdempotencyStore(),
    undefined,
    storage,
    documents,
    false,
  );
}

function createRequest(
  document: LayerDocument,
  format: "txt" | "csv" | "json",
): ExportRequest {
  return {
    projectId: document.projectId,
    sourceVersionId: document.sourceVersionId!,
    format,
    scope: "full-document",
    scale: 1,
    colorProfile: "sRGB",
    namingPresetId: "kinetic-words",
  };
}

function createBookDocument(fullText = "الفصل الأول"): LayerDocument {
  const projectId = crypto.randomUUID();
  const sourceVersionId = crypto.randomUUID();
  const pageGroup: LayerNode = {
    id: crypto.randomUUID(),
    parentId: null,
    kind: "group",
    name: "+page_001",
    visible: true,
    locked: true,
    opacity: 1,
    fixed: true,
    zIndex: 0,
    pageNumber: 1,
    bounds: { x: 0, y: 0, width: 320, height: 180 },
  };
  const background: LayerNode = {
    id: crypto.randomUUID(),
    parentId: pageGroup.id,
    kind: "raster",
    name: "+page_001_background",
    visible: true,
    locked: true,
    opacity: 1,
    fixed: true,
    zIndex: 0,
    pageNumber: 1,
    bounds: { x: 0, y: 0, width: 320, height: 180 },
    fillColor: "#ffffff",
  };
  const text: LayerNode = {
    id: crypto.randomUUID(),
    parentId: pageGroup.id,
    kind: "text",
    name: "+الفصل_الأول",
    visible: true,
    locked: false,
    opacity: 1,
    fixed: false,
    zIndex: 1,
    pageNumber: 1,
    bounds: { x: 40, y: 30, width: 240, height: 30 },
    fullText,
    readingOrder: 0,
    direction: "rtl",
    textAlign: "justify",
  };
  return {
    schemaVersion: "1.0",
    projectId,
    sourceVersionId,
    revision: 1,
    generatedAt: timestamp,
    width: 320,
    height: 180,
    colorSpace: "sRGB",
    pages: [{ pageNumber: 1, width: 320, height: 180 }],
    layers: [pageGroup, background, text],
  };
}
