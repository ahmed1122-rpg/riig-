import { writeFile } from "node:fs/promises";
import sharp from "sharp";

const width = 720;
const height = 480;
const pixels = Buffer.alloc(width * height * 4);

paintRect(55, 55, 180, 130, [45, 174, 162, 255]);
paintRect(310, 60, 130, 180, [105, 135, 216, 230]);
paintRect(530, 80, 120, 100, [211, 155, 69, 255]);
paintRect(120, 300, 155, 105, [156, 114, 203, 255]);
paintRect(430, 310, 210, 90, [235, 113, 134, 210]);

const output = new URL("./alpha-components.png", import.meta.url);
await writeFile(
  output,
  await sharp(pixels, {
    raw: { width, height, channels: 4 },
  })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

function paintRect(left, top, rectWidth, rectHeight, color) {
  for (let y = top; y < top + rectHeight; y += 1) {
    for (let x = left; x < left + rectWidth; x += 1) {
      const offset = (y * width + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3];
    }
  }
}
