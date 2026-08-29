import { createHash, type BinaryLike } from "node:crypto";

/** Computes the canonical lowercase hexadecimal SHA-256 representation. */
export function sha256Hex(value: BinaryLike): string {
  return createHash("sha256").update(value).digest("hex");
}
