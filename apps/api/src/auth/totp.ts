import { createHmac, timingSafeEqual } from "node:crypto";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(bytes: Uint8Array): string {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");

  let encoded = "";
  for (let index = 0; index < bits.length; index += 5) {
    const chunk = bits.slice(index, index + 5).padEnd(5, "0");
    encoded += base32Alphabet[Number.parseInt(chunk, 2)];
  }
  return encoded;
}

export function createTotpCode(
  secret: string,
  timestampMs = Date.now(),
  stepSeconds = 30,
): string {
  const counter = Math.floor(timestampMs / 1000 / stepSeconds);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(counterBytes)
    .digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

export function verifyTotpCode(
  secret: string,
  code: string,
  timestampMs = Date.now(),
  window = 1,
): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const received = Buffer.from(code);
  for (let offset = -window; offset <= window; offset += 1) {
    const expected = Buffer.from(
      createTotpCode(secret, timestampMs + offset * 30_000),
    );
    if (
      received.length === expected.length &&
      timingSafeEqual(received, expected)
    ) {
      return true;
    }
  }
  return false;
}

export function createOtpAuthUri(input: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const label = `${input.issuer}:${input.account}`;
  const query = new URLSearchParams({
    secret: input.secret,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function formatRecoveryCode(value: string): string {
  const normalized = value.toUpperCase();
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`;
}

function decodeBase32(value: string): Buffer {
  const normalized = value
    .toUpperCase()
    .replace(/=+$/u, "")
    .replace(/\s+/gu, "");
  let bits = "";
  for (const character of normalized) {
    const index = base32Alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid Base32 TOTP secret.");
    bits += index.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}
