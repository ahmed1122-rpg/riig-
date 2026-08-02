import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { createZipArchive } from "./export-archive.js";

describe("createZipArchive", () => {
  it("compresses entries asynchronously without blocking the current turn", async () => {
    const turnCompleted = vi.fn();
    queueMicrotask(turnCompleted);

    const pending = createZipArchive({
      "manifest.json": strToU8('{"version":1}'),
      "layers/readme.txt": strToU8("layer archive"),
    });
    await Promise.resolve();
    expect(turnCompleted).toHaveBeenCalledOnce();

    const archive = unzipSync(await pending);
    expect(strFromU8(archive["manifest.json"]!)).toBe('{"version":1}');
    expect(strFromU8(archive["layers/readme.txt"]!)).toBe("layer archive");
  });
});
