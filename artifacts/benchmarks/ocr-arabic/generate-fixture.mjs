import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const metadata = JSON.parse(
  await readFile(join(fixtureDirectory, "expected.json"), "utf8"),
);
const fontFileName = "NotoNaskhArabic[wght].ttf";
const fontUrl =
  `https://raw.githubusercontent.com/google/fonts/${metadata.font.commit}` +
  `/ofl/notonaskharabic/${encodeURIComponent(fontFileName)}`;
const temporaryDirectory = await mkdtemp(
  join(tmpdir(), "motionprep-ocr-fixture-"),
);
const fontPath = join(temporaryDirectory, fontFileName);

try {
  const response = await fetch(fontUrl, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`Unable to fetch benchmark font (${response.status}).`);
  }
  const fontBytes = Buffer.from(await response.arrayBuffer());
  const fontDigest = createHash("sha256").update(fontBytes).digest("hex");
  if (fontDigest !== metadata.font.sha256) {
    throw new Error(
      `Benchmark font digest mismatch: expected ${metadata.font.sha256}, got ${fontDigest}.`,
    );
  }
  await writeFile(fontPath, fontBytes);
  if (!GlobalFonts.registerFromPath(fontPath, metadata.font.family)) {
    throw new Error("Unable to register the benchmark font.");
  }

  const canvas = createCanvas(1600, 900);
  const context = canvas.getContext("2d");
  context.fillStyle = "#f7f5ef";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#161616";
  context.font = `400 72px "${metadata.font.family}"`;
  context.direction = "rtl";
  context.textAlign = "right";
  context.textBaseline = "alphabetic";
  metadata.sourceLines.forEach((line, index) => {
    context.fillText(line, 1490, 220 + index * 170);
  });

  // Deterministic scan-like marks exercise binarization without hiding glyphs.
  context.globalAlpha = 0.035;
  context.fillStyle = "#000000";
  for (let y = 32; y < canvas.height; y += 83) {
    context.fillRect(22, y, canvas.width - 44, 1);
  }
  context.globalAlpha = 1;

  const outputPath = join(fixtureDirectory, metadata.fixture);
  const output = await canvas.encode("png");
  await writeFile(outputPath, output);
  const digest = createHash("sha256").update(output).digest("hex");
  console.log(
    JSON.stringify(
      {
        outputPath,
        bytes: output.length,
        sha256: digest,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
