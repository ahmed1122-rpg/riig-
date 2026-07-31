import { createHash } from "node:crypto";
import type { SourceType } from "@motionprep/contracts";

export interface InspectedSource {
  contentType: SourceType;
  sizeBytes: number;
  sha256: string;
}

function startsWith(bytes: Buffer, signature: number[]): boolean {
  return signature.every((byte, index) => bytes[index] === byte);
}

export function detectSourceType(bytes: Buffer): SourceType | null {
  if (
    startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 16 &&
    bytes.subarray(4, 8).toString("ascii") === "ftyp" &&
    /(?:avif|avis)/u.test(
      bytes.subarray(8, Math.min(bytes.length, 40)).toString("ascii"),
    )
  ) {
    return "image/avif";
  }
  if (
    startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) ||
    startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
  ) {
    return "image/tiff";
  }
  if (startsWith(bytes, [0x42, 0x4d])) {
    return "image/bmp";
  }
  if (bytes.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

export function inspectSource(bytes: Buffer): InspectedSource | null {
  const contentType = detectSourceType(bytes);
  if (!contentType) return null;
  return {
    contentType,
    sizeBytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
