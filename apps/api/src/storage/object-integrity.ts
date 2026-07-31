import { createHash } from "node:crypto";
import type {
  StoredObject,
  StoredObjectMetadata,
} from "./object-storage.js";

export interface StoredObjectExpectation {
  sizeBytes: number;
  sha256: string;
  contentType?: string;
}

export function hasExpectedObjectIntegrity(
  object: StoredObject,
  expected: StoredObjectExpectation,
): boolean {
  if (
    object.sizeBytes !== expected.sizeBytes ||
    (expected.contentType !== undefined &&
      object.contentType !== expected.contentType)
  ) {
    return false;
  }
  return (
    createHash("sha256").update(object.body).digest("hex") ===
    expected.sha256.toLowerCase()
  );
}

export function hasExpectedObjectMetadata(
  object: StoredObjectMetadata,
  expected: StoredObjectExpectation,
): boolean {
  return (
    object.sizeBytes === expected.sizeBytes &&
    object.sha256 === expected.sha256.toLowerCase() &&
    (expected.contentType === undefined ||
      object.contentType === expected.contentType)
  );
}
