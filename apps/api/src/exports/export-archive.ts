import { zip, type AsyncZippable } from "fflate";

export function createZipArchive(entries: AsyncZippable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    });
  });
}
