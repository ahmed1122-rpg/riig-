import { sha256Hex } from "../shared/sha256.js";

/**
 * Produces a deterministic JSON representation for request identity checks.
 * Object key order is ignored, while array order and JSON value semantics are
 * preserved. Inputs are expected to be validated request DTOs.
 */
export function canonicalRequestJson(value: unknown): string {
  return canonicalize(value, new Set<object>(), false);
}

export function requestFingerprint(namespace: string, value: unknown): string {
  return sha256Hex(`${namespace}\0${canonicalRequestJson(value)}`);
}

function canonicalize(
  value: unknown,
  ancestors: Set<object>,
  arrayEntry: boolean,
): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? JSON.stringify(value) : "null";
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return arrayEntry ? "null" : "";
  }
  if (typeof value === "bigint") {
    throw new TypeError("BigInt values cannot be fingerprinted as JSON.");
  }
  if (typeof value !== "object") return JSON.stringify(value);
  if (ancestors.has(value)) {
    throw new TypeError("Circular request values cannot be fingerprinted.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value
        .map((entry) => canonicalize(entry, ancestors, true))
        .join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .flatMap((key) => {
        const encoded = canonicalize(record[key], ancestors, false);
        return encoded === ""
          ? []
          : [`${JSON.stringify(key)}:${encoded}`];
      });
    return `{${entries.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}
