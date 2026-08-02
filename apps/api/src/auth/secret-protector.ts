import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export interface SecretProtector {
  protect(value: string): string;
  unprotect(value: string): string;
  hashRecoveryCode(value: string): string;
  verifyRecoveryCode(value: string, expectedHash: string): boolean;
}

export class AesGcmSecretProtector implements SecretProtector {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) {
      throw new Error("Auth encryption key must contain exactly 32 bytes.");
    }
  }

  protect(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return ["v1", iv, tag, encrypted]
      .map((part) =>
        typeof part === "string" ? part : part.toString("base64url"),
      )
      .join(".");
  }

  unprotect(value: string): string {
    const [version, iv, tag, encrypted] = value.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) {
      throw new Error("Unsupported protected secret format.");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  hashRecoveryCode(value: string): string {
    return createHmac("sha256", this.key)
      .update(normalizeRecoveryCode(value))
      .digest("hex");
  }

  verifyRecoveryCode(value: string, expectedHash: string): boolean {
    const actual = Buffer.from(this.hashRecoveryCode(value), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
}

export function decodeAuthEncryptionKey(value: string): Buffer {
  if (!isValidAuthEncryptionKey(value)) {
    throw new Error("AUTH_ENCRYPTION_KEY must be canonical Base64 for exactly 32 bytes.");
  }
  const key = Buffer.from(value, "base64");
  return key;
}

export function isValidAuthEncryptionKey(value: string): boolean {
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(value)) return false;
  const key = Buffer.from(value, "base64");
  return key.length === 32 && key.toString("base64") === value;
}

export function createEphemeralSecretProtector(): SecretProtector {
  return new AesGcmSecretProtector(randomBytes(32));
}

function normalizeRecoveryCode(value: string): string {
  return value.trim().replace(/[\s-]+/gu, "").toUpperCase();
}
