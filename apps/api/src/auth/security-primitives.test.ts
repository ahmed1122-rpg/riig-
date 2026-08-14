import { describe, expect, it } from "vitest";
import { scryptSync } from "node:crypto";
import {
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "./password.js";
import {
  AesGcmSecretProtector,
  KeyringSecretProtector,
  decodeAuthEncryptionKey,
  decodeAuthEncryptionKeyring,
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
    expect(encoded).toMatch(/^scrypt\$v2\$16384\$8\$1\$/u);
    expect(passwordHashNeedsUpgrade(encoded)).toBe(false);
    await expect(verifyPassword("StrongPass123", encoded)).resolves.toBe(true);
    await expect(
      verifyPassword("StrongPass123", "scrypt$not-hex$" + "0".repeat(128)),
    ).resolves.toBe(false);
    await expect(
      verifyPassword("StrongPass123", "scrypt$" + "0".repeat(32) + "$z".repeat(64)),
    ).resolves.toBe(false);
  });

  it("accepts legacy hashes and marks them for progressive rehash", async () => {
    const salt = Buffer.alloc(16, 4);
    const key = scryptSync("StrongPass123", salt, 64);
    const legacy = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;

    await expect(verifyPassword("StrongPass123", legacy)).resolves.toBe(true);
    expect(passwordHashNeedsUpgrade(legacy)).toBe(true);
  });

  it("rotates MFA encryption and recovery hashing without losing old data", () => {
    const oldKey = Buffer.alloc(32, 7);
    const newKey = Buffer.alloc(32, 8);
    const legacy = new AesGcmSecretProtector(oldKey);
    const legacyCiphertext = legacy.protect("JBSWY3DPEHPK3PXP");
    const legacyRecoveryHash = legacy.hashRecoveryCode("abcd-1234");
    const firstRing = new KeyringSecretProtector(
      "old",
      new Map([["old", oldKey]]),
    );
    const versionedCiphertext = firstRing.protect("JBSWY3DPEHPK3PXP");
    const versionedRecoveryHash = firstRing.hashRecoveryCode("abcd-1234");
    const rotated = new KeyringSecretProtector(
      "new",
      new Map([
        ["old", oldKey],
        ["new", newKey],
      ]),
    );

    expect(rotated.unprotect(legacyCiphertext)).toBe("JBSWY3DPEHPK3PXP");
    expect(rotated.unprotect(versionedCiphertext)).toBe("JBSWY3DPEHPK3PXP");
    expect(rotated.verifyRecoveryCode("abcd-1234", legacyRecoveryHash)).toBe(true);
    expect(rotated.verifyRecoveryCode("abcd-1234", versionedRecoveryHash)).toBe(true);
    expect(rotated.protect("new-secret")).toMatch(/^v2\.new\./u);
    expect(rotated.hashRecoveryCode("new-code")).toMatch(/^v2\.new\./u);
  });

  it("parses a bounded keyring and rejects duplicate IDs", () => {
    const encoded = Buffer.alloc(32, 4).toString("base64");
    expect(decodeAuthEncryptionKeyring(`primary:${encoded}`).get("primary"))
      .toEqual(Buffer.alloc(32, 4));
    expect(() =>
      decodeAuthEncryptionKeyring(`primary:${encoded},primary:${encoded}`),
    ).toThrow(/comma-separated/u);
  });
});
