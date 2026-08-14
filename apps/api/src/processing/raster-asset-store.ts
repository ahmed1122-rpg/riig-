import { createHash } from "node:crypto";
import type { LayerDocument, RasterAssetReference } from "@motionprep/contracts";
import {
  isObjectStorageIntegrityFailure,
  type ObjectStorage,
  type StoredObject,
} from "../storage/object-storage.js";
import { hasExpectedObjectIntegrity } from "../storage/object-integrity.js";
import { ProcessingDomainError } from "./processing-errors.js";
import type { DerivedAssetRegistry } from "../storage/derived-asset-registry.js";

export class RasterAssetStore {
  constructor(
    private readonly storage: ObjectStorage,
    private readonly registry?: DerivedAssetRegistry,
  ) {}

  async load(reference: RasterAssetReference): Promise<StoredObject | null> {
    let object: StoredObject | null;
    try {
      object = await this.storage.get(reference.objectKey, {
        maxBytes: reference.sizeBytes,
      });
    } catch (error) {
      if (isObjectStorageIntegrityFailure(error)) {
        throw integrityFailure();
      }
      throw error;
    }
    if (object && !hasExpectedObjectIntegrity(object, reference)) {
      throw integrityFailure();
    }
    return object;
  }

  storeTool(
    document: LayerDocument,
    revision: number,
    tool: "edge-refine" | "merge",
    layerId: string,
    operationId: string,
    body: Buffer,
  ): Promise<RasterAssetReference> {
    return this.store(
      document.projectId,
      [
        "derived",
        encodeURIComponent(document.projectId),
        encodeURIComponent(document.sourceVersionId ?? "source"),
        "tools",
        `revision-${revision}`,
        `${tool}-${encodeURIComponent(layerId)}-${encodeURIComponent(operationId)}.png`,
      ].join("/"),
      body,
      "tool",
    );
  }

  storeGuided(
    document: LayerDocument,
    revision: number,
    layerId: string,
    role: "refined" | "separated",
    operationId: string,
    body: Buffer,
  ): Promise<RasterAssetReference> {
    return this.store(
      document.projectId,
      [
        "derived",
        encodeURIComponent(document.projectId),
        encodeURIComponent(document.sourceVersionId ?? "source"),
        "guidance",
        `revision-${revision}`,
        `${encodeURIComponent(layerId)}-${role}-${encodeURIComponent(operationId)}.png`,
      ].join("/"),
      body,
      "guidance",
    );
  }

  private async store(
    projectId: string,
    objectKey: string,
    body: Buffer,
    category: "tool" | "guidance",
  ): Promise<RasterAssetReference> {
    const reference: RasterAssetReference = {
      objectKey,
      contentType: "image/png",
      sizeBytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
    await this.registry?.register(projectId, objectKey, category);
    await this.storage.put({ key: objectKey, ...reference, body });
    return reference;
  }
}

function integrityFailure(): ProcessingDomainError {
  return new ProcessingDomainError(
    "LAYER_ASSET_INTEGRITY_FAILED",
    "فشل التحقق من سلامة أصل طبقة Raster المخزن.",
  );
}
