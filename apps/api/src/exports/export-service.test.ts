import type {
  ExportRequest,
  LayerDocument,
  LayerNode,
} from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import { InMemoryIdempotencyStore } from "../idempotency/idempotency-store.js";
import { InMemoryLayerDocumentRepository } from "../processing/processing-repository.js";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import { InMemoryExportRepository } from "./export-repository.js";
import { ExportService } from "./export-service.js";

const timestamp = "2026-07-28T10:00:00.000Z";

describe("ExportService worker execution", () => {
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
    await expect(repository.list()).resolves.toHaveLength(0);
  });

  it("fails a queued export if the layer document changes before the worker claims it", async () => {
    const repository = new InMemoryExportRepository();
    const storage = new InMemoryObjectStorage();
    const documents = new InMemoryLayerDocumentRepository();
    const document = { ...createBookDocument(), revision: 2 };
    await documents.save(document);
    const service = createWorkerService(repository, storage, documents);
    const queued = await service.create(
      { ...createRequest(document, "txt"), documentRevision: 2 },
      "book",
      "document-changed-before-worker",
    );
    await documents.save({ ...document, revision: 3 });

    await expect(
      service.claimAndProcess("export-worker-revision", 60_000),
    ).resolves.toMatchObject({
      id: queued.id,
      status: "failed",
      errorCode: "EXPORT_DOCUMENT_REVISION_CONFLICT",
    });
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

    const artifact = await service.artifact(queued.id);
    expect(artifact.contentType).toBe("text/plain; charset=utf-8");
    expect(artifact.body.toString("utf8")).toContain("الفصل الأول");
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
    const artifactKey = [
      "artifacts",
      encodeURIComponent(document.projectId),
      ready.id,
      ready.artifact!.filename,
    ].join("/");
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
    const artifactKey = [
      "artifacts",
      encodeURIComponent(document.projectId),
      ready.id,
      ready.artifact!.filename,
    ].join("/");
    currentTime = new Date(Date.parse(timestamp) + 24 * 60 * 60_000 + 1);

    await expect(service.artifact(ready.id)).rejects.toMatchObject({
      code: "EXPORT_ARTIFACT_NOT_READY",
    });
    await expect(storage.get(artifactKey)).resolves.toBeNull();
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
    expect(await repository.list()).toEqual([
      expect.objectContaining({
        status: "failed",
        errorCode: "EXPORT_WORKER_FAILED",
      }),
    ]);
  });
});

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
  const background: LayerNode = {
    id: crypto.randomUUID(),
    parentId: null,
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
    parentId: null,
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
    layers: [background, text],
  };
}
