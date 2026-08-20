import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = path.join(
  root,
  "assets/visual-sources/manifest.json",
);
const manifestDirectory = path.dirname(manifestPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const violations = [];

if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
  violations.push("Visual manifest must contain at least one asset.");
}

for (const [index, asset] of (manifest.assets ?? []).entries()) {
  const label = asset.output ?? `asset ${index + 1}`;
  if (!asset.output || !asset.role || !asset.generator || !asset.license) {
    violations.push(`${label} is missing output, role, generator, or license.`);
    continue;
  }
  if (!["project-owned", "project-generated", "user-authorized project use"].includes(asset.license)) {
    violations.push(`${label} uses an unapproved license value.`);
  }
  if (asset.sourcePath) {
    violations.push(
      `${label} uses legacy sourcePath; use a repository-relative source or an opaque externalSourceRef.`,
    );
  }
  if (asset.source && asset.externalSourceRef) {
    violations.push(`${label} cannot define both source and externalSourceRef.`);
  }
  if (asset.externalSourceRef) {
    if (!/^user-authorized:[a-z0-9-]+$/u.test(asset.externalSourceRef)) {
      violations.push(`${label} has an invalid externalSourceRef.`);
    }
    if (!asset.sourceSha256) {
      violations.push(`${label} must retain a source SHA-256 for external evidence.`);
    }
  }

  const outputPath = path.resolve(manifestDirectory, asset.output);
  try {
    await access(outputPath);
    const metadata = await sharp(outputPath).metadata();
    if (metadata.width !== asset.width || metadata.height !== asset.height) {
      violations.push(
        `${label} dimensions changed: expected ${asset.width}x${asset.height}, received ${metadata.width}x${metadata.height}.`,
      );
    }
    if (typeof asset.alpha === "boolean" && Boolean(metadata.hasAlpha) !== asset.alpha) {
      violations.push(
        `${label} alpha contract changed: expected ${asset.alpha}, received ${Boolean(metadata.hasAlpha)}.`,
      );
    }
    if (asset.outputSha256) {
      const digest = await sha256(outputPath);
      if (digest !== asset.outputSha256.toUpperCase()) {
        violations.push(`${label} output SHA-256 does not match the manifest.`);
      }
    }
  } catch (error) {
    violations.push(
      `${label} cannot be verified: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const sourcePath = asset.source
    ? path.resolve(manifestDirectory, asset.source)
    : undefined;
  if (sourcePath && asset.sourceSha256) {
    try {
      await access(sourcePath);
      const digest = await sha256(sourcePath);
      if (digest !== asset.sourceSha256.toUpperCase()) {
        violations.push(`${label} source SHA-256 does not match the manifest.`);
      }
    } catch (error) {
      if (asset.source) {
        violations.push(
          `${label} source cannot be verified: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  for (const violation of violations) process.stderr.write(`- ${violation}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Visual asset manifest verified (${manifest.assets.length} assets).\n`,
  );
}

async function sha256(filename) {
  return createHash("sha256")
    .update(await readFile(filename))
    .digest("hex")
    .toUpperCase();
}
