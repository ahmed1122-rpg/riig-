import { describe, expect, it } from "vitest";
import {
  canonicalRequestJson,
  requestFingerprint,
} from "./request-fingerprint.js";

describe("request fingerprint", () => {
  it("ignores object key order but preserves nested array order", () => {
    const left = { options: { scale: 1, scope: "full" }, layers: [1, 2] };
    const reordered = {
      layers: [1, 2],
      options: { scope: "full", scale: 1 },
    };

    expect(canonicalRequestJson(left)).toBe(canonicalRequestJson(reordered));
    expect(requestFingerprint("export", left)).toBe(
      requestFingerprint("export", reordered),
    );
    expect(requestFingerprint("export", left)).not.toBe(
      requestFingerprint("export", { ...reordered, layers: [2, 1] }),
    );
  });

  it("matches JSON handling for undefined object and array values", () => {
    expect(canonicalRequestJson({ present: true, omitted: undefined })).toBe(
      '{"present":true}',
    );
    expect(canonicalRequestJson([true, undefined])).toBe("[true,null]");
  });

  it("separates namespaces and rejects circular inputs", () => {
    expect(requestFingerprint("upload", { id: 1 })).not.toBe(
      requestFingerprint("export", { id: 1 }),
    );
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => canonicalRequestJson(circular)).toThrow(/Circular/u);
  });
});
