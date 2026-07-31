import { describe, expect, it } from "vitest";
import { detectSourceType } from "./source-inspection.js";

describe("detectSourceType", () => {
  it.each([
    [
      "image/avif",
      Buffer.from([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70,
        0x61, 0x76, 0x69, 0x66, 0x00, 0x00, 0x00, 0x00,
      ]),
    ],
    ["image/tiff", Buffer.from([0x49, 0x49, 0x2a, 0x00])],
    ["image/tiff", Buffer.from([0x4d, 0x4d, 0x00, 0x2a])],
    ["image/bmp", Buffer.from([0x42, 0x4d, 0x10, 0x00])],
  ] as const)("recognizes %s from its binary signature", (type, bytes) => {
    expect(detectSourceType(bytes)).toBe(type);
  });

  it("does not trust an extension-like string without a valid signature", () => {
    expect(detectSourceType(Buffer.from("fake.avif"))).toBeNull();
  });
});
