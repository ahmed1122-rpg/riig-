import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const assetsDirectory = path.join(root, "apps/web/dist/assets");
const budgets = {
  ".js": 160 * 1024,
  ".css": 50 * 1024,
};
const totals = new Map(Object.keys(budgets).map((extension) => [extension, 0]));

for (const filename of await readdir(assetsDirectory)) {
  const extension = path.extname(filename);
  if (!totals.has(extension)) continue;
  const source = await readFile(path.join(assetsDirectory, filename));
  totals.set(extension, (totals.get(extension) ?? 0) + gzipSync(source).byteLength);
}

const violations = [];
for (const [extension, maximum] of Object.entries(budgets)) {
  const actual = totals.get(extension) ?? 0;
  if (actual > maximum) {
    violations.push(
      `${extension.slice(1).toUpperCase()} gzip total ${formatKiB(actual)} exceeds ${formatKiB(maximum)}.`,
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) process.stderr.write(`- ${violation}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Web bundle budget verified: JS ${formatKiB(totals.get(".js") ?? 0)}, CSS ${formatKiB(totals.get(".css") ?? 0)}.\n`,
  );
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}
