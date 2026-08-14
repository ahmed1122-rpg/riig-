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
      scripts: { "test:e2e:install": "playwright install chromium" },
    }),
    [
      "test:e2e:install must install firefox.",
      "test:e2e:install must install webkit.",
    ],
  );
});
