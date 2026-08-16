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

export const releasePlaywrightImage =
  "mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e";

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
    if (
      name.startsWith("mobile-") &&
      name !== "mobile-webkit" &&
      project.use?.hasTouch !== true
    ) {
      violations.push(`${name} must exercise touch input.`);
    }
    if (name === "mobile-webkit" && project.use?.hasTouch !== false) {
      violations.push(
        "mobile-webkit must disable unstable synthetic touch emulation on Linux.",
      );
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
    if (name.endsWith("-webkit") && project.retries !== 2) {
      violations.push(
        `${name} must retain two retries for the isolated Linux WebKit gate.`,
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

  const webServers = Array.isArray(config.webServer)
    ? config.webServer
    : [config.webServer].filter(Boolean);
  const webServer = webServers.find((server) =>
    server?.command?.includes("@motionprep/web"),
  );
  const webCommand = webServer?.command ?? "";
  if (
    !webCommand.includes("npm run build --workspace @motionprep/web") ||
    !webCommand.includes("npm run preview --workspace @motionprep/web")
  ) {
    violations.push(
      "The release browser gate must build and serve the production web bundle.",
    );
  }
  if (webCommand.includes("npm run dev --workspace @motionprep/web")) {
    violations.push("The release browser gate must not qualify the Vite development server.");
  }
  if (webServer?.env?.VITE_API_ORIGIN !== "") {
    violations.push(
      "The production browser bundle must use its same-origin API fallback.",
    );
  }
  if (!webServer?.env?.PLAYWRIGHT_PREVIEW_API_ORIGIN) {
    violations.push(
      "The production preview must proxy same-origin API requests to the isolated E2E API.",
    );
  }

  return violations;
}

export function validateBrowserWorkflow(workflowSource) {
  const violations = [];
  if (!workflowSource.includes(`image: ${releasePlaywrightImage}`)) {
    violations.push(
      "browser-e2e must use the repository-approved Playwright image and digest.",
    );
  }
  if (!workflowSource.includes("options: --user 1001 --init --ipc=host")) {
    violations.push(
      "browser-e2e must run the Playwright container with the approved non-root, init, and IPC options.",
    );
  }
  if (workflowSource.includes("npm run test:e2e:install")) {
    violations.push(
      "browser-e2e must use the browsers preinstalled in the pinned Playwright image.",
    );
  }
  if (!workflowSource.includes("engine: [chromium, firefox, webkit]")) {
    violations.push(
      "browser-e2e must isolate Chromium, Firefox, and WebKit in separate matrix jobs.",
    );
  }
  if (!workflowSource.includes("npm run test:e2e:${{ matrix.engine }}")) {
    violations.push(
      "browser-e2e matrix jobs must invoke only their selected engine.",
    );
  }
  if (!workflowSource.includes("name: playwright-evidence-${{ matrix.engine }}")) {
    violations.push(
      "browser-e2e failure evidence must be unique to each engine job.",
    );
  }
  return violations;
}

async function main() {
  const [{ default: config }, packageSource, workflowSource] = await Promise.all([
    import("../playwright.config.ts"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  ]);
  const violations = [
    ...validateBrowserMatrix(config, JSON.parse(packageSource)),
    ...validateBrowserWorkflow(workflowSource),
  ];
  assert.deepEqual(violations, [], violations.join("\n"));
  process.stdout.write(
    `Browser matrix verified (${Object.keys(requiredBrowserProjects).length} release projects).\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
