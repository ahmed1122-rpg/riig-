import assert from "node:assert/strict";
import test from "node:test";
import {
  requiredBrowserProjects,
  validateBrowserMatrix,
} from "./verify-browser-matrix.mjs";

function validConfig() {
  return {
    projects: Object.entries(requiredBrowserProjects).map(([name, browserName]) => ({
      name,
      use: {
        browserName,
        ...(name.startsWith("mobile-") ? { hasTouch: true } : {}),
        viewport: {
          width: name.startsWith("mobile-") ? 412 : 1_440,
          height: name.startsWith("mobile-") ? 915 : 900,
        },
      },
    })),
  };
}

const packageManifest = {
  scripts: {
    "test:e2e": "node scripts/run-browser-matrix.mjs",
    "test:e2e:chromium":
      "playwright test --project=desktop-chromium --project=mobile-chromium",
    "test:e2e:firefox":
      "playwright test --project=desktop-firefox --project=mobile-firefox",
    "test:e2e:webkit": "node scripts/run-webkit-e2e.mjs",
    "test:e2e:install": "playwright install --with-deps chromium firefox webkit",
  },
};

test("accepts desktop and mobile projects for every release browser engine", () => {
  assert.deepEqual(validateBrowserMatrix(validConfig(), packageManifest), []);
});

test("rejects missing, implicit, and non-mobile browser projects", () => {
  const config = validConfig();
  config.projects = config.projects
    .filter(({ name }) => name !== "desktop-webkit")
    .map((project) =>
      project.name === "desktop-firefox"
        ? { ...project, use: { ...project.use, browserName: undefined } }
        : project.name === "mobile-chromium"
          ? { ...project, use: { ...project.use, viewport: { width: 800, height: 900 } } }
          : project,
    );

  assert.deepEqual(validateBrowserMatrix(config, packageManifest), [
    "mobile-chromium must exercise a mobile-sized viewport.",
    "desktop-firefox must explicitly use firefox.",
    "Playwright project desktop-webkit is required.",
  ]);
});

test("rejects an incomplete Playwright browser installation", () => {
  assert.deepEqual(
    validateBrowserMatrix(validConfig(), {
      scripts: {
        ...packageManifest.scripts,
        "test:e2e:install": "playwright install chromium",
      },
    }),
    [
      "test:e2e:install must install firefox.",
      "test:e2e:install must install webkit.",
    ],
  );
});

test("rejects a combined or incomplete engine execution contract", () => {
  assert.deepEqual(
    validateBrowserMatrix(validConfig(), {
      scripts: {
        ...packageManifest.scripts,
        "test:e2e": "playwright test",
        "test:e2e:webkit": "playwright test --project=desktop-webkit",
      },
    }),
    [
      "test:e2e:webkit must isolate desktop-webkit and mobile-webkit tests through the WebKit runner.",
      "test:e2e must isolate each browser engine through the matrix runner.",
    ],
  );
});

test("rejects unstable iOS emulation in the Linux WebKit profile", () => {
  const config = validConfig();
  config.projects = config.projects.map((project) =>
    project.name === "mobile-webkit"
      ? { ...project, use: { ...project.use, isMobile: true } }
      : project,
  );

  assert.deepEqual(validateBrowserMatrix(config, packageManifest), [
    "mobile-webkit must avoid the unstable iOS-only isMobile emulation on Linux.",
  ]);
});
