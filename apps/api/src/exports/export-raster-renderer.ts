interface SolidPngInput {
  width: number;
  height: number;
  background: string;
}

export async function renderSolidPng(input: SolidPngInput): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  return sharp({
    create: {
      width: input.width,
      height: input.height,
      channels: 4,
      background: input.background,
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
