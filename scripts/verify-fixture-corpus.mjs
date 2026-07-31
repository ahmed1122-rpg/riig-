import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(
  await readFile(join(root, "assets/manifests/corpus.json"), "utf8"),
);
const violations = [];
if (manifest.schemaVersion !== "1.0") {
  violations.push("Unsupported fixture corpus schema.");
}
if (!Array.isArray(manifest.items) || manifest.items.length < 3) {
  violations.push("The release corpus must contain image, PDF, and OCR fixtures.");
}
const ids = new Set();
for (const item of manifest.items ?? []) {
  if (ids.has(item.id)) violations.push(`Duplicate corpus id: ${item.id}`);
  ids.add(item.id);
  for (const field of ["path", "source", "owner", "license", "expected"]) {
    if (typeof item[field] !== "string" || item[field].trim() === "") {
      violations.push(`${item.id}.${field} is required.`);
    }
  }
  if (!Array.isArray(item.risks) || item.risks.length === 0) {
    violations.push(`${item.id}.risks must identify covered failure modes.`);
  }
  try {
    const bytes = await readFile(join(root, item.path));
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== item.sha256) {
      violations.push(
        `${item.id} digest mismatch: expected ${item.sha256}, got ${digest}.`,
      );
    }
  } catch (error) {
    violations.push(
      `${item.id} cannot be read: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

if (violations.length > 0) {
  for (const violation of violations) process.stderr.write(`- ${violation}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Fixture corpus verified (${manifest.items.length} licensed deterministic items).\n`,
  );
}
