import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";
import {
  decodeAuthEncryptionKey,
  isValidAuthEncryptionKey,
} from "./secret-protector.js";

describe("authentication security primitives", () => {
  it("accepts only canonical 32-byte Base64 encryption keys", () => {
    const valid = Buffer.alloc(32, 7).toString("base64");
    expect(isValidAuthEncryptionKey(valid)).toBe(true);
    expect(decodeAuthEncryptionKey(valid)).toEqual(Buffer.alloc(32, 7));

    const ignoredCharacterVariant = `!${valid}`;
    expect(Buffer.from(ignoredCharacterVariant, "base64")).toHaveLength(32);
    expect(isValidAuthEncryptionKey(ignoredCharacterVariant)).toBe(false);
    expect(() => decodeAuthEncryptionKey(ignoredCharacterVariant)).toThrow(
      /canonical Base64/u,
    );
  });

  it("rejects malformed stored password encodings before deriving a key", async () => {
    const encoded = await hashPassword("StrongPass123");
    await expect(verifyPassword("StrongPass123", encoded)).resolves.toBe(true);
    await expect(
      verifyPassword("StrongPass123", "scrypt$not-hex$" + "0".repeat(128)),
    ).resolves.toBe(false);
    await expect(
      verifyPassword("StrongPass123", "scrypt$" + "0".repeat(32) + "$z".repeat(64)),
    ).resolves.toBe(false);
  });
});
