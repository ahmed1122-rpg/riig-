import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const assetsDirectory = path.join(root, "apps/web/dist/assets");
const budgets = {
  // The measured release candidate is 181.3 KiB after adding independent
  // command feedback, navigable asset diagnostics, guarded reorder, and
  // direct PDF text correction. Keep a narrow 0.7 KiB ratchet; route startup
  // remains protected independently by the request, LCP-asset, font, and
  // per-chunk budgets below.
  ".js": 182 * 1024,
  ".css": 50 * 1024,
};
const maximumJavaScriptChunk = 64 * 1024;
const totals = new Map(Object.keys(budgets).map((extension) => [extension, 0]));
const javascriptChunks = [];
const violations = [];
let landingMetrics;

for (const filename of await readdir(assetsDirectory)) {
  const extension = path.extname(filename);
  if (!totals.has(extension)) continue;
  const source = await readFile(path.join(assetsDirectory, filename));
  const compressedBytes = gzipSync(source).byteLength;
  totals.set(extension, (totals.get(extension) ?? 0) + compressedBytes);
  if (extension === ".js") {
    javascriptChunks.push({ filename, compressedBytes });
  }
}

const publicSourceMaps = (await readdir(assetsDirectory)).filter((filename) =>
  filename.endsWith(".map"),
);
if (publicSourceMaps.length > 0) {
  violations.push(
    `Public dist contains ${publicSourceMaps.length} source maps; move them to private release evidence.`,
  );
}

const manifest = JSON.parse(
  await readFile(path.join(root, "apps/web/dist/.vite/manifest.json"), "utf8"),
);
const entry = Object.values(manifest).find((item) => item.isEntry);
const landing = Object.entries(manifest).find(([key]) =>
  key.endsWith("/features/marketing/LandingPage.tsx"),
)?.[1];
if (!entry || !landing) {
  violations.push("Vite manifest is missing the entry or landing route.");
} else {
  const initialFiles = collectManifestFiles(manifest, [entry, landing]);
  const heroPath = path.join(
    root,
    "apps/web/public/visuals/hero-anime-studio.webp",
  );
  const heroBytes = (await stat(heroPath)).size;
  const requestCount = initialFiles.size + 1;
  landingMetrics = { requestCount, heroBytes, fontRequests: 0 };
  if (requestCount > 12) {
    violations.push(
      `Guest landing requires ${requestCount} initial asset requests; maximum is 12.`,
    );
  }
  if (heroBytes > 256 * 1024) {
    violations.push(
      `Landing LCP image is ${formatKiB(heroBytes)}; maximum is 256.0 KiB.`,
    );
  }
  const initialCss = [...initialFiles].filter((file) => file.endsWith(".css"));
  let fontRequests = 0;
  for (const file of initialCss) {
    const css = await readFile(path.join(root, "apps/web/dist", file), "utf8");
    fontRequests += (css.match(/@font-face/gu) ?? []).length;
  }
  landingMetrics.fontRequests = fontRequests;
  if (fontRequests > 0) {
    violations.push(
      `Initial route declares ${fontRequests} web fonts; budget is zero blocking font requests.`,
    );
  }
}

for (const [extension, maximum] of Object.entries(budgets)) {
  const actual = totals.get(extension) ?? 0;
  if (actual > maximum) {
    violations.push(
      `${extension.slice(1).toUpperCase()} gzip total ${formatKiB(actual)} exceeds ${formatKiB(maximum)}.`,
    );
  }
}
for (const chunk of javascriptChunks) {
  if (chunk.compressedBytes > maximumJavaScriptChunk) {
    violations.push(
      `JS chunk ${chunk.filename} is ${formatKiB(chunk.compressedBytes)}; maximum is ${formatKiB(maximumJavaScriptChunk)}.`,
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) process.stderr.write(`- ${violation}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Web bundle budget verified: JS ${formatKiB(totals.get(".js") ?? 0)}, CSS ${formatKiB(totals.get(".css") ?? 0)}${landingMetrics ? `; landing ${landingMetrics.requestCount} requests, hero ${formatKiB(landingMetrics.heroBytes)}, fonts ${landingMetrics.fontRequests}` : ""}.\n`,
  );
}

function formatKiB(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function collectManifestFiles(manifest, roots) {
  const files = new Set();
  const visited = new Set();
  const visit = (item) => {
    if (!item || visited.has(item.file)) return;
    visited.add(item.file);
    files.add(item.file);
    for (const css of item.css ?? []) files.add(css);
    for (const asset of item.assets ?? []) files.add(asset);
    for (const imported of item.imports ?? []) visit(manifest[imported]);
  };
  roots.forEach(visit);
  return files;
}
