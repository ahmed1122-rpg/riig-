import { createHash } from "node:crypto";
import type { LayerDocument, RasterAssetReference } from "@motionprep/contracts";
import {
  isObjectStorageIntegrityFailure,
  type ObjectStorage,
  type StoredObject,
} from "../storage/object-storage.js";
import { hasExpectedObjectIntegrity } from "../storage/object-integrity.js";
import { ProcessingDomainError } from "./processing-errors.js";

export class RasterAssetStore {
  constructor(private readonly storage: ObjectStorage) {}

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
    body: Buffer,
  ): Promise<RasterAssetReference> {
    return this.store(
      [
        "derived",
        encodeURIComponent(document.projectId),
        encodeURIComponent(document.sourceVersionId ?? "source"),
        "tools",
        `revision-${revision}`,
        `${tool}-${encodeURIComponent(layerId)}.png`,
      ].join("/"),
      body,
    );
  }

  storeGuided(
    document: LayerDocument,
    revision: number,
    layerId: string,
    role: "refined" | "separated",
    body: Buffer,
  ): Promise<RasterAssetReference> {
    return this.store(
      [
        "derived",
        encodeURIComponent(document.projectId),
        encodeURIComponent(document.sourceVersionId ?? "source"),
        "guidance",
        `revision-${revision}`,
        `${encodeURIComponent(layerId)}-${role}.png`,
      ].join("/"),
      body,
    );
  }

  private async store(
    objectKey: string,
    body: Buffer,
  ): Promise<RasterAssetReference> {
    const reference: RasterAssetReference = {
      objectKey,
      contentType: "image/png",
      sizeBytes: body.byteLength,
      sha256: createHash("sha256").update(body).digest("hex"),
    };
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
