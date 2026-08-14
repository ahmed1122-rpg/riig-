import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const workspaceRoot = path.resolve(webRoot, "../..");
const dist = path.join(webRoot, "dist");
const target = path.join(
  workspaceRoot,
  "artifacts",
  "private-sourcemaps",
  "web-current",
);
const permittedRoot = path.join(workspaceRoot, "artifacts", "private-sourcemaps");
if (!target.startsWith(`${permittedRoot}${path.sep}`)) {
  throw new Error("Private source-map output escaped the permitted artifact root.");
}

await rm(target, { recursive: true, force: true });
const files = await readdir(dist, { recursive: true, withFileTypes: true });
let moved = 0;
for (const entry of files) {
  if (!entry.isFile() || !entry.name.endsWith(".map")) continue;
  const parent = entry.parentPath ?? entry.path;
  const source = path.join(parent, entry.name);
  const relative = path.relative(dist, source);
  const destination = path.join(target, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
  moved += 1;
}
if (moved === 0) throw new Error("Vite did not generate private source maps.");
process.stdout.write(`Moved ${moved} private web source maps outside dist.\n`);
