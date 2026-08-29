import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // API files initialize Fastify, Sharp, and cryptographic helpers. Capping
    // file workers avoids coverage-only timeout flakes on high-core hosts
    // without serializing the suite on smaller CI runners.
    maxWorkers: "50%",
    testTimeout: 15_000,
    hookTimeout: 15_000,
    exclude: [
      "src/**/*.integration.test.ts",
      "**/node_modules/**",
      "**/dist/**",
    ],
  },
});
