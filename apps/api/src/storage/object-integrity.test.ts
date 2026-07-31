import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasExpectedObjectIntegrity } from "./object-integrity.js";

const body = Buffer.from("motionprep cloud object");
const expected = {
  contentType: "application/octet-stream",
  sizeBytes: body.byteLength,
  sha256: createHash("sha256").update(body).digest("hex"),
};

describe("hasExpectedObjectIntegrity", () => {
  it("accepts bytes, size, hash, and content type that all match", () => {
    expect(
      hasExpectedObjectIntegrity(
        {
          key: "source/project/object.bin",
          body,
          contentType: expected.contentType,
          sizeBytes: expected.sizeBytes,
        },
        expected,
      ),
    ).toBe(true);
  });

  it.each([
    { body: Buffer.from("tampered"), sizeBytes: 8 },
    { body, sizeBytes: body.byteLength + 1 },
    {
      body,
      sizeBytes: body.byteLength,
      contentType: "text/plain",
    },
  ])("rejects a mismatched cloud object", (changes) => {
    expect(
      hasExpectedObjectIntegrity(
        {
          key: "source/project/object.bin",
          body: changes.body,
          contentType: changes.contentType ?? expected.contentType,
          sizeBytes: changes.sizeBytes,
        },
        expected,
      ),
    ).toBe(false);
  });
});
