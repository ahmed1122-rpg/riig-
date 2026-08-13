import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_VERSION = "v2";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const SALT_HEX_PATTERN = /^[a-f0-9]{32}$/u;
const KEY_HEX_PATTERN = new RegExp(`^[a-f0-9]{${KEY_LENGTH * 2}}$`, "u");

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return [
    "scrypt",
    SCRYPT_VERSION,
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString("hex"),
    key.toString("hex"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parsed = parsePasswordHash(encoded);
  if (!parsed) return false;
  const { saltHex, expectedHex } = parsed;
  const actual = await derive(password, Buffer.from(saltHex, "hex"));
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordHashNeedsUpgrade(encoded: string): boolean {
  return parsePasswordHash(encoded)?.version === "legacy";
}

function parsePasswordHash(encoded: string): {
  version: "legacy" | "v2";
  saltHex: string;
  expectedHex: string;
} | null {
  const parts = encoded.split("$");
  if (parts.length === 3) {
    const [algorithm, saltHex, expectedHex] = parts;
    return algorithm === "scrypt" && validPayload(saltHex, expectedHex)
      ? { version: "legacy", saltHex: saltHex!, expectedHex: expectedHex! }
      : null;
  }
  const [algorithm, version, cost, blockSize, parallelization, saltHex, expectedHex] = parts;
  if (
    algorithm !== "scrypt" ||
    version !== SCRYPT_VERSION ||
    cost !== String(SCRYPT_COST) ||
    blockSize !== String(SCRYPT_BLOCK_SIZE) ||
    parallelization !== String(SCRYPT_PARALLELIZATION) ||
    !saltHex ||
    !expectedHex ||
    !validPayload(saltHex, expectedHex)
  ) {
    return null;
  }
  return { version: "v2", saltHex, expectedHex };
}

function validPayload(saltHex: string | undefined, expectedHex: string | undefined): boolean {
  return Boolean(
    saltHex && expectedHex &&
    SALT_HEX_PATTERN.test(saltHex) && KEY_HEX_PATTERN.test(expectedHex),
  );
}
