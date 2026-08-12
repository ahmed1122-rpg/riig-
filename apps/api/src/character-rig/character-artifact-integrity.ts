import type { CharacterArtifactReference } from "@motionprep/contracts";
import { hasExpectedObjectIntegrity } from "../storage/object-integrity.js";
import {
  isObjectStorageIntegrityFailure,
  type ObjectStorage,
  type StoredObject,
} from "../storage/object-storage.js";

export async function readVerifiedCharacterArtifact(
  storage: ObjectStorage,
  expected: CharacterArtifactReference,
  maxBytes: number,
): Promise<StoredObject | null> {
  if (expected.sizeBytes > maxBytes) return null;
  let stored;
  try {
    stored = await storage.get(expected.objectKey, { maxBytes });
  } catch (error) {
    if (isObjectStorageIntegrityFailure(error)) return null;
    throw error;
  }
  if (
    !stored ||
    stored.contentType !== expected.contentType ||
    stored.sizeBytes !== expected.sizeBytes ||
    !hasExpectedObjectIntegrity(stored, expected)
  ) {
    return null;
  }
  return stored;
}
