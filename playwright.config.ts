import { defineConfig, devices } from "@playwright/test";

const apiPort = resolveE2ePort("PLAYWRIGHT_API_PORT", 45_100);
const webPort = resolveE2ePort("PLAYWRIGHT_WEB_PORT", 45_101);

if (apiPort === webPort) {
  throw new Error("PLAYWRIGHT_API_PORT and PLAYWRIGHT_WEB_PORT must differ.");
}

const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;
const webkitDiagnostics = {
  trace: "on-first-retry" as const,
  video: "off" as const,
};

export default defineConfig({
  testDir: "./e2e",
  outputDir: "artifacts/playwright",
  fullyParallel: false,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [["line"], ["html", { outputFolder: "artifacts/playwright-report", open: "never" }]]
    : "line",
  use: {
    baseURL: webOrigin,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        browserName: "chromium",
      },
    },
    {
      name: "desktop-firefox",
      use: {
        ...devices["Desktop Firefox"],
        browserName: "firefox",
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "mobile-firefox",
      use: {
        ...devices["Desktop Firefox"],
        browserName: "firefox",
        deviceScaleFactor: 2,
        hasTouch: true,
        viewport: { width: 412, height: 915 },
      },
    },
    {
      name: "desktop-webkit",
      retries: 2,
      use: {
        ...devices["Desktop Safari"],
        ...webkitDiagnostics,
        browserName: "webkit",
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "mobile-webkit",
      retries: 2,
      use: {
        ...devices["Desktop Safari"],
        ...webkitDiagnostics,
        browserName: "webkit",
        deviceScaleFactor: 1,
        hasTouch: true,
        // Playwright's iOS-only isMobile emulation crashes WebKitGTK on Linux.
        // Touch remains enabled so this profile exercises the phone interaction path.
        viewport: { width: 390, height: 844 },
      },
    },
  ],
  webServer: [
    {
      command: "npm run serve:e2e --workspace @motionprep/api",
      url: `${apiOrigin}/v1/health/live`,
      env: {
        NODE_ENV: "test",
        RELEASE_VERSION: "playwright-e2e",
        API_PORT: String(apiPort),
        WEB_ORIGIN: webOrigin,
        COOKIE_SECURE: "false",
        PAYMENT_MODE: "sandbox",
        USAGE_METERING_MODE: "off",
        PERSISTENCE_MODE: "memory",
        DATABASE_URL: "",
        REDIS_URL: "",
        OBJECT_STORAGE_MODE: "memory",
        PROCESSING_EXECUTION_MODE: "inline",
        EXPORT_EXECUTION_MODE: "inline",
        PDF_OCR_MODE: "disabled",
        PDF_REGION_OCR_ENABLED: "false",
        CHARACTER_RIG_ENABLED: "false",
        EMAIL_DELIVERY_MODE: "memory",
        AUTH_ENCRYPTION_KEY: "",
        E2E_ADMIN_EMAIL: "playwright-admin@example.test",
      },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: [
        "npm run build --workspace @motionprep/web",
        `npm run preview --workspace @motionprep/web -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      ].join(" && "),
      url: webOrigin,
      env: {
        VITE_API_ORIGIN: "",
        PLAYWRIGHT_PREVIEW_API_ORIGIN: apiOrigin,
      },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});

function resolveE2ePort(name: string, fallback: number): number {
  const configured = process.env[name]?.trim();
  if (!configured) return fallback;
  if (!/^\d+$/u.test(configured)) {
    throw new Error(`${name} must be an integer TCP port.`);
  }
  const port = Number(configured);
  if (!Number.isSafeInteger(port) || port < 1_024 || port > 65_535) {
    throw new Error(`${name} must be between 1024 and 65535.`);
  }
  return port;
}
