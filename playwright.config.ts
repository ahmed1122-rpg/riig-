import { defineConfig, devices } from "@playwright/test";

const apiPort = resolveE2ePort("PLAYWRIGHT_API_PORT", 45_100);
const webPort = resolveE2ePort("PLAYWRIGHT_WEB_PORT", 45_101);

if (apiPort === webPort) {
  throw new Error("PLAYWRIGHT_API_PORT and PLAYWRIGHT_WEB_PORT must differ.");
}

const apiOrigin = `http://127.0.0.1:${apiPort}`;
const webOrigin = `http://127.0.0.1:${webPort}`;

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
        viewport: { width: 1_440, height: 900 },
      },
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
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
        E2E_ADMIN_EMAIL: "",
      },
      reuseExistingServer: false,
      timeout: 30_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command:
        `npm run dev --workspace @motionprep/web -- --host 127.0.0.1 --port ${webPort} --strictPort`,
      url: webOrigin,
      env: {
        VITE_API_ORIGIN: apiOrigin,
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
