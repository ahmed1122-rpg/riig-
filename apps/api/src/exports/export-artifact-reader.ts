import type { ExportJob } from "@motionprep/contracts";
import type {
  ObjectStorage,
  StoredObject,
  StoredObjectStream,
} from "../storage/object-storage.js";
import { isObjectStorageIntegrityFailure } from "../storage/object-storage.js";
import {
  hasExpectedObjectIntegrity,
  hasExpectedObjectMetadata,
} from "../storage/object-integrity.js";
import { ExportDomainError } from "./export-errors.js";

export function exportArtifactKey(job: ExportJob): string {
  return `artifacts/${job.projectId}/${job.id}/${job.artifact?.filename ?? "pending"}`;
}

export class ExportArtifactReader {
  constructor(
    private readonly storage?: ObjectStorage,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(job: ExportJob): Promise<StoredObject> {
    const storage = this.requireReadyStorage(job);
    await this.rejectExpired(job, storage);
    let object: StoredObject | null;
    try {
      object = await storage.get(exportArtifactKey(job), {
        maxBytes: job.artifact!.sizeBytes,
      });
    } catch (error) {
      if (isObjectStorageIntegrityFailure(error)) {
        throw integrityError();
      }
      throw error;
    }
    if (!object) throw unavailableError();
    if (
      !hasExpectedObjectIntegrity(object, {
        sizeBytes: job.artifact!.sizeBytes,
        sha256: job.artifact!.sha256,
      })
    ) {
      throw integrityError();
    }
    return object;
  }

  async stream(
    job: ExportJob,
    signal?: AbortSignal,
  ): Promise<StoredObjectStream> {
    const storage = this.requireReadyStorage(job);
    await this.rejectExpired(job, storage);
    const object = await storage.getStream(
      exportArtifactKey(job),
      signal ? { signal } : undefined,
    );
    if (!object) throw unavailableError();
    if (!hasExpectedObjectMetadata(object, job.artifact!)) {
      object.body.destroy();
      throw integrityError();
    }
    return object;
  }

  private requireReadyStorage(job: ExportJob): ObjectStorage {
    if (job.status !== "ready" || !job.artifact || !this.storage) {
      throw new ExportDomainError(
        "EXPORT_ARTIFACT_NOT_READY",
        "ملف التصدير غير جاهز للتنزيل.",
      );
    }
    return this.storage;
  }

  private async rejectExpired(
    job: ExportJob,
    storage: ObjectStorage,
  ): Promise<void> {
    if (Date.parse(job.artifact!.expiresAt) > this.now().getTime()) return;
    await storage.delete(exportArtifactKey(job)).catch(() => undefined);
    throw new ExportDomainError(
      "EXPORT_ARTIFACT_NOT_READY",
      "انتهت مدة الاحتفاظ بملف التصدير.",
    );
  }
}

function unavailableError(): ExportDomainError {
  return new ExportDomainError(
    "EXPORT_ARTIFACT_NOT_READY",
    "ملف التصدير غير متاح أو انتهت مدة الاحتفاظ به.",
  );
}

function integrityError(): ExportDomainError {
  return new ExportDomainError(
    "EXPORT_ARTIFACT_INTEGRITY_FAILED",
    "فشل التحقق من سلامة ملف التصدير المخزن.",
  );
}
