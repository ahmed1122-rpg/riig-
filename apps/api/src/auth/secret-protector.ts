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

export class KeyringSecretProtector implements SecretProtector {
  readonly #activeKey: Buffer;
  readonly #keys: ReadonlyMap<string, Buffer>;

  constructor(
    readonly activeKeyId: string,
    keys: ReadonlyMap<string, Buffer>,
    legacyKeys: readonly Buffer[] = [],
  ) {
    if (!/^[A-Za-z0-9_-]{1,32}$/u.test(activeKeyId)) {
      throw new Error("Auth encryption active key ID is invalid.");
    }
    const combined = new Map(keys);
    for (const [keyId, key] of combined) {
      if (!/^[A-Za-z0-9_-]{1,32}$/u.test(keyId) || key.length !== 32) {
        throw new Error("Every auth keyring entry must have a valid ID and 32-byte key.");
      }
    }
    const activeKey = combined.get(activeKeyId);
    if (!activeKey) throw new Error("Auth encryption active key is missing from the keyring.");
    legacyKeys.forEach((key, index) => {
      if (key.length !== 32) throw new Error("Legacy auth keys must contain 32 bytes.");
      combined.set(`legacy-${index}`, key);
    });
    this.#activeKey = activeKey;
    this.#keys = combined;
  }

  protect(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#activeKey, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ["v2", this.activeKeyId, iv, tag, encrypted]
      .map((part) => typeof part === "string" ? part : part.toString("base64url"))
      .join(".");
  }

  unprotect(value: string): string {
    const parts = value.split(".");
    if (parts[0] === "v2") {
      const [, keyId, iv, tag, encrypted] = parts;
      const key = keyId ? this.#keys.get(keyId) : undefined;
      if (!key || !iv || !tag || !encrypted) {
        throw new Error("Unsupported protected secret format.");
      }
      return decryptSecret(key, iv, tag, encrypted);
    }
    if (parts[0] === "v1" && parts.length === 4) {
      const [, iv, tag, encrypted] = parts;
      if (!iv || !tag || !encrypted) {
        throw new Error("Unsupported protected secret format.");
      }
      for (const key of this.#keys.values()) {
        try {
          return decryptSecret(key, iv, tag, encrypted);
        } catch {
          // Continue through the bounded configured keyring for legacy v1 data.
        }
      }
    }
    throw new Error("Unsupported protected secret format.");
  }

  hashRecoveryCode(value: string): string {
    return `v2.${this.activeKeyId}.${recoveryDigest(this.#activeKey, value)}`;
  }

  verifyRecoveryCode(value: string, expectedHash: string): boolean {
    const [version, keyId, digest, extra] = expectedHash.split(".");
    if (version === "v2" && keyId && digest && !extra) {
      const key = this.#keys.get(keyId);
      return Boolean(key && safeDigestEqual(recoveryDigest(key, value), digest));
    }
    return [...this.#keys.values()].some((key) =>
      safeDigestEqual(recoveryDigest(key, value), expectedHash),
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

export function decodeAuthEncryptionKeyring(value: string): Map<string, Buffer> {
  const keyring = new Map<string, Buffer>();
  for (const rawEntry of value.split(",")) {
    const separator = rawEntry.indexOf(":");
    const keyId = rawEntry.slice(0, separator).trim();
    const encoded = rawEntry.slice(separator + 1).trim();
    if (
      separator < 1 ||
      !/^[A-Za-z0-9_-]{1,32}$/u.test(keyId) ||
      keyring.has(keyId) ||
      !isValidAuthEncryptionKey(encoded)
    ) {
      throw new Error(
        "AUTH_ENCRYPTION_KEYRING must be comma-separated key-id:canonical-base64 entries.",
      );
    }
    keyring.set(keyId, decodeAuthEncryptionKey(encoded));
  }
  if (keyring.size === 0 || keyring.size > 5) {
    throw new Error("AUTH_ENCRYPTION_KEYRING must contain from one to five keys.");
  }
  return keyring;
}

export function isValidAuthEncryptionKeyring(value: string): boolean {
  try {
    decodeAuthEncryptionKeyring(value);
    return true;
  } catch {
    return false;
  }
}

export function createEphemeralSecretProtector(): SecretProtector {
  return new AesGcmSecretProtector(randomBytes(32));
}

function normalizeRecoveryCode(value: string): string {
  return value.trim().replace(/[\s-]+/gu, "").toUpperCase();
}

function decryptSecret(key: Buffer, iv: string, tag: string, encrypted: string): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function recoveryDigest(key: Buffer, value: string): string {
  return createHmac("sha256", key)
    .update(normalizeRecoveryCode(value))
    .digest("hex");
}

function safeDigestEqual(actualHex: string, expectedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(expectedHex)) return false;
  return timingSafeEqual(Buffer.from(actualHex, "hex"), Buffer.from(expectedHex, "hex"));
}
