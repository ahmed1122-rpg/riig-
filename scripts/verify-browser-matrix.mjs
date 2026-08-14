import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const requiredBrowserProjects = Object.freeze({
  "desktop-chromium": "chromium",
  "mobile-chromium": "chromium",
  "desktop-firefox": "firefox",
  "mobile-firefox": "firefox",
  "desktop-webkit": "webkit",
  "mobile-webkit": "webkit",
});

export function validateBrowserMatrix(config, packageManifest) {
  const violations = [];
  const projects = new Map(
    (config.projects ?? []).map((project) => [project.name, project]),
  );

  for (const [name, browserName] of Object.entries(requiredBrowserProjects)) {
    const project = projects.get(name);
    if (!project) {
      violations.push(`Playwright project ${name} is required.`);
      continue;
    }
    if (project.use?.browserName !== browserName) {
      violations.push(`${name} must explicitly use ${browserName}.`);
    }
    const width = project.use?.viewport?.width;
    if (name.startsWith("mobile-") && (!Number.isFinite(width) || width > 430)) {
      violations.push(`${name} must exercise a mobile-sized viewport.`);
    }
    if (name.startsWith("mobile-") && project.use?.hasTouch !== true) {
      violations.push(`${name} must exercise touch input.`);
    }
    if (name === "mobile-webkit" && project.use?.isMobile === true) {
      violations.push(
        "mobile-webkit must avoid the unstable iOS-only isMobile emulation on Linux.",
      );
    }
    if (name.endsWith("-webkit") && (
      project.use?.video !== "off" ||
      project.use?.trace !== "on-first-retry"
    )) {
      violations.push(
        `${name} must use low-overhead crash diagnostics on Linux.`,
      );
    }
    if (name === "mobile-webkit" && project.use?.deviceScaleFactor !== 1) {
      violations.push(
        "mobile-webkit must use DPR 1 in the Linux qualification gate.",
      );
    }
  }

  const installCommand = packageManifest.scripts?.["test:e2e:install"] ?? "";
  for (const browserName of ["chromium", "firefox", "webkit"]) {
    if (!new RegExp(`(?:^|\\s)${browserName}(?:\\s|$)`, "u").test(installCommand)) {
      violations.push(`test:e2e:install must install ${browserName}.`);
    }

    const engineCommand = packageManifest.scripts?.[`test:e2e:${browserName}`] ?? "";
    if (browserName === "webkit") {
      if (engineCommand !== "node scripts/run-webkit-e2e.mjs") {
        violations.push(
          "test:e2e:webkit must isolate desktop-webkit and mobile-webkit tests through the WebKit runner.",
        );
      }
      continue;
    }
    for (const profile of ["desktop", "mobile"]) {
      if (!engineCommand.includes(`--project=${profile}-${browserName}`)) {
        violations.push(
          `test:e2e:${browserName} must run ${profile}-${browserName}.`,
        );
      }
    }
  }

  if (packageManifest.scripts?.["test:e2e"] !== "node scripts/run-browser-matrix.mjs") {
    violations.push("test:e2e must isolate each browser engine through the matrix runner.");
  }

  return violations;
}

async function main() {
  const [{ default: config }, packageSource] = await Promise.all([
    import("../playwright.config.ts"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const violations = validateBrowserMatrix(config, JSON.parse(packageSource));
  assert.deepEqual(violations, [], violations.join("\n"));
  process.stdout.write(
    `Browser matrix verified (${Object.keys(requiredBrowserProjects).length} release projects).\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
