import type { UploadSession } from "@motionprep/contracts";
import { describe, expect, it } from "vitest";
import {
  InMemoryObjectStorage,
  ObjectStorageIntegrityError,
  type StoredObjectMetadata,
} from "../storage/object-storage.js";
import { resolveUploadFinalizationOutcome } from "./upload-finalization-recovery.js";
import type { UploadIntegrityFailureCommand } from "./upload-integrity-failure.js";
import { InMemoryUploadRepository } from "./upload-repository.js";

class UnreadableUploadRepository extends InMemoryUploadRepository {
  override async findById(): Promise<UploadSession | null> {
    throw new Error("database read unavailable");
  }
}

class CorruptMetadataStorage extends InMemoryObjectStorage {
  override async inspect(): Promise<StoredObjectMetadata | null> {
    throw new ObjectStorageIntegrityError("source-object");
  }
}

const failingIntegrityCommand: UploadIntegrityFailureCommand = {
  async markIntegrityFailure() {
    throw new Error("integrity transition unavailable");
  },
};

describe("resolveUploadFinalizationOutcome observations", () => {
  it("reports an ambiguous repository read without replacing the outcome", async () => {
    const session = readySession();
    const observed: string[] = [];

    await expect(
      resolveUploadFinalizationOutcome({
        attempted: session,
        expectedSha256: session.sha256!,
        uploads: new UnreadableUploadRepository(),
        storage: new InMemoryObjectStorage(),
        onObservationError: (_error, stage) => {
          observed.push(stage);
          throw new Error("observer unavailable");
        },
      }),
    ).resolves.toEqual({ kind: "unknown" });
    expect(observed).toEqual(["repository_read"]);
  });

  it("reports corrupt metadata and a failed integrity transition", async () => {
    const session = readySession();
    const uploads = new InMemoryUploadRepository();
    const observed: string[] = [];
    await uploads.save(session);

    await expect(
      resolveUploadFinalizationOutcome({
        attempted: session,
        expectedSha256: session.sha256!,
        uploads,
        storage: new CorruptMetadataStorage(),
        integrityFailures: failingIntegrityCommand,
        onObservationError: (_error, stage) => observed.push(stage),
      }),
    ).resolves.toEqual({ kind: "unknown" });
    expect(observed).toEqual([
      "integrity_failure_record",
      "storage_inspect",
    ]);
  });

  it("reports a failed missing-object transition", async () => {
    const session = readySession();
    const uploads = new InMemoryUploadRepository();
    const observed: string[] = [];
    await uploads.save(session);

    await expect(
      resolveUploadFinalizationOutcome({
        attempted: session,
        expectedSha256: session.sha256!,
        uploads,
        storage: new InMemoryObjectStorage(),
        integrityFailures: failingIntegrityCommand,
        onObservationError: (_error, stage) => observed.push(stage),
      }),
    ).resolves.toEqual({ kind: "unknown" });
    expect(observed).toEqual(["integrity_failure_record"]);
  });
});

function readySession(): UploadSession {
  return {
    uploadId: crypto.randomUUID(),
    objectKey: "source-object",
    expiresAt: "2026-08-04T10:00:00.000Z",
    maxBytes: 1024,
    uploadUrl: "/v1/uploads/source/content",
    projectId: crypto.randomUUID(),
    filename: "source.png",
    contentType: "image/png",
    expectedSizeBytes: 10,
    status: "ready",
    sourceVersionId: crypto.randomUUID(),
    sha256: "a".repeat(64),
    createdAt: "2026-08-04T09:00:00.000Z",
    updatedAt: "2026-08-04T09:01:00.000Z",
  };
}
