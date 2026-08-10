import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readPsd } from "ag-psd";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const generatedDirectory = join(
  root,
  "artifacts",
  "adobe-golden",
  "generated",
);
const manifest = JSON.parse(
  await readFile(join(generatedDirectory, "manifest.json"), "utf8"),
);
const expectedFiles = new Set(["image-layers.psd", "book-pages.psd"]);

assert(manifest.schemaVersion === 1, "Unsupported Adobe Golden manifest.");
assert(
  Array.isArray(manifest.files) && manifest.files.length === expectedFiles.size,
  "Adobe Golden manifest must list exactly two PSD files.",
);

for (const entry of manifest.files) {
  assert(expectedFiles.delete(entry.filename), `Unexpected file ${entry.filename}.`);
  const body = await readFile(join(generatedDirectory, entry.filename));
  const sha256 = createHash("sha256").update(body).digest("hex");
  assert(body.byteLength === entry.sizeBytes, `${entry.filename} size drifted.`);
  assert(sha256 === entry.sha256, `${entry.filename} SHA-256 drifted.`);

  const psd = readPsd(body, {
    skipCompositeImageData: true,
    skipLayerImageData: true,
    skipThumbnail: true,
  });
  assert(psd.width === entry.expected.width, `${entry.filename} width drifted.`);
  assert(psd.height === entry.expected.height, `${entry.filename} height drifted.`);
  assert(psd.bitsPerChannel === 8, `${entry.filename} is not 8-bit.`);
  assert(psd.colorMode === 3, `${entry.filename} is not RGB.`);
  assert(
    JSON.stringify(
      [...(psd.children ?? [])].reverse().map((layer) => layer.name),
    ) ===
      JSON.stringify(entry.expected.rootLayers),
    `${entry.filename} Adobe root-layer order drifted.`,
  );

  if (entry.filename === "image-layers.psd") {
    const [card, background] = [...(psd.children ?? [])].reverse();
    assert(
      Math.abs((card?.opacity ?? 0) - 0.72) < 0.005,
      "Golden card opacity is not 72%.",
    );
    assert(
      background?.protected?.position === true &&
        background.protected.composite === true &&
        background.protected.transparency === true,
      "Golden background is not fully locked.",
    );
  }
}

assert(expectedFiles.size === 0, "Adobe Golden manifest is incomplete.");
console.log("Adobe Golden manifest, hashes, and PSD structure are valid.");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
