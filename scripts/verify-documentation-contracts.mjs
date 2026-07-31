import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const buildMapPath = new URL("../docs/BUILD_MAP.md", import.meta.url);
const contractsPath = new URL(
  "../packages/contracts/src/index.ts",
  import.meta.url,
);
const uploadRoutesPath = new URL(
  "../apps/api/src/uploads/upload-routes.ts",
  import.meta.url,
);
const [buildMap, contracts, uploadRoutes] = await Promise.all([
  readFile(buildMapPath, "utf8"),
  readFile(contractsPath, "utf8"),
  readFile(uploadRoutesPath, "utf8"),
]);
const violations = [];

const capabilityContract = contracts.match(
  /export const exportFormatsByProjectKind = \{([\s\S]*?)\n\} as const satisfies/u,
)?.[1];
const exportFormatsByProjectKind = { image: [], book: [] };
if (!capabilityContract) {
  violations.push(
    "Could not discover exportFormatsByProjectKind from the shared contract.",
  );
} else {
  for (const projectKind of ["image", "book"]) {
    const formats = capabilityContract.match(
      new RegExp(`${projectKind}:\\s*\\[([\\s\\S]*?)\\]`, "u"),
    )?.[1];
    if (!formats) {
      violations.push(`The shared contract is missing ${projectKind} formats.`);
      continue;
    }
    exportFormatsByProjectKind[projectKind] = [
      ...formats.matchAll(/"([^"]+)"/gu),
    ].map((match) => match[1]);
  }
}

const uploadIntentRoute = uploadRoutes.match(
  /app\.post\("(\/v1\/[^"\n]*uploads\/intents)"/,
)?.[1];
if (!uploadIntentRoute) {
  violations.push("Could not discover the upload-intent route from upload-routes.ts.");
} else if (!buildMap.includes(`POST ${uploadIntentRoute}`)) {
  violations.push(
    `docs/BUILD_MAP.md must document the current upload route: POST ${uploadIntentRoute}`,
  );
}

if (buildMap.includes("/v1/projects/:projectId/uploads")) {
  violations.push(
    "docs/BUILD_MAP.md still contains the retired project-scoped upload route.",
  );
}

const capabilityBlock = buildMap.match(
  /<!-- export-capabilities:start -->([\s\S]*?)<!-- export-capabilities:end -->/,
)?.[1];
if (!capabilityBlock) {
  violations.push("docs/BUILD_MAP.md is missing the export capability table markers.");
} else {
  const documented = { image: [], book: [] };
  for (const line of capabilityBlock.split(/\r?\n/u)) {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const format = cells[0]?.match(/^`([^`]+)`/u)?.[1];
    if (!format) continue;
    if (cells[1] !== "—") documented.image.push(format);
    if (cells[2] !== "—") documented.book.push(format);
  }

  for (const projectKind of ["image", "book"]) {
    const expected = [...exportFormatsByProjectKind[projectKind]];
    if (JSON.stringify(documented[projectKind]) !== JSON.stringify(expected)) {
      violations.push(
        `Export formats for ${projectKind} differ: documented=${JSON.stringify(documented[projectKind])}, contract=${JSON.stringify(expected)}.`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error(`Documentation contract violations in ${repositoryRoot}:`);
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log("Upload and export documentation contracts verified.");
}
