import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SALT_HEX_PATTERN = /^[a-f0-9]{32}$/u;
const KEY_HEX_PATTERN = new RegExp(`^[a-f0-9]{${KEY_LENGTH * 2}}$`, "u");

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, saltHex, expectedHex] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !saltHex ||
    !expectedHex ||
    !SALT_HEX_PATTERN.test(saltHex) ||
    !KEY_HEX_PATTERN.test(expectedHex)
  ) {
    return false;
  }

  const actual = await derive(password, Buffer.from(saltHex, "hex"));
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
