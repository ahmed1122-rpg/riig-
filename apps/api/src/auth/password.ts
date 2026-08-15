import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const CURRENT_SCRYPT = {
  version: "v3",
  cost: 32_768,
  blockSize: 8,
  parallelization: 3,
} as const;
const LEGACY_V2_SCRYPT = {
  version: "v2",
  cost: 16_384,
  blockSize: 8,
  parallelization: 1,
} as const;
const WRITE_SCRYPT = CURRENT_SCRYPT;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const SALT_HEX_PATTERN = /^[a-f0-9]{32}$/u;
const KEY_HEX_PATTERN = new RegExp(`^[a-f0-9]{${KEY_LENGTH * 2}}$`, "u");

interface ScryptParameters {
  cost: number;
  blockSize: number;
  parallelization: number;
}

function derive(
  password: string,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, {
      N: parameters.cost,
      r: parameters.blockSize,
      p: parameters.parallelization,
      maxmem: SCRYPT_MAX_MEMORY,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, WRITE_SCRYPT);
  return [
    "scrypt",
    WRITE_SCRYPT.version,
    WRITE_SCRYPT.cost,
    WRITE_SCRYPT.blockSize,
    WRITE_SCRYPT.parallelization,
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
  const { saltHex, expectedHex, parameters } = parsed;
  const actual = await derive(
    password,
    Buffer.from(saltHex, "hex"),
    parameters,
  );
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function passwordHashNeedsUpgrade(encoded: string): boolean {
  const parsed = parsePasswordHash(encoded);
  return Boolean(
    parsed && passwordHashVersionRank(parsed.version) <
      passwordHashVersionRank(WRITE_SCRYPT.version),
  );
}

function passwordHashVersionRank(version: "legacy" | "v2" | "v3"): number {
  return version === "legacy" ? 1 : version === "v2" ? 2 : 3;
}

function parsePasswordHash(encoded: string): {
  version: "legacy" | "v2" | "v3";
  saltHex: string;
  expectedHex: string;
  parameters: ScryptParameters;
} | null {
  const parts = encoded.split("$");
  if (parts.length === 3) {
    const [algorithm, saltHex, expectedHex] = parts;
    return algorithm === "scrypt" && validPayload(saltHex, expectedHex)
      ? {
          version: "legacy",
          saltHex: saltHex!,
          expectedHex: expectedHex!,
          parameters: LEGACY_V2_SCRYPT,
        }
      : null;
  }
  const [algorithm, version, cost, blockSize, parallelization, saltHex, expectedHex] = parts;
  const parameters = version === CURRENT_SCRYPT.version
    ? CURRENT_SCRYPT
    : version === LEGACY_V2_SCRYPT.version
      ? LEGACY_V2_SCRYPT
      : null;
  if (
    algorithm !== "scrypt" ||
    !parameters ||
    cost !== String(parameters.cost) ||
    blockSize !== String(parameters.blockSize) ||
    parallelization !== String(parameters.parallelization) ||
    !saltHex ||
    !expectedHex ||
    !validPayload(saltHex, expectedHex)
  ) {
    return null;
  }
  return { version: parameters.version, saltHex, expectedHex, parameters };
}

function validPayload(saltHex: string | undefined, expectedHex: string | undefined): boolean {
  return Boolean(
    saltHex && expectedHex &&
    SALT_HEX_PATTERN.test(saltHex) && KEY_HEX_PATTERN.test(expectedHex),
  );
}
