import { describe, expect, it } from "vitest";
import { assertProductionDependencies } from "./app.js";

describe("production dependency wiring", () => {
  it("fails before startup instead of silently selecting in-memory stores", () => {
    expect(() => assertProductionDependencies({
      NODE_ENV: "production",
      PAYMENT_MODE: "disabled",
      CHARACTER_RIG_ENABLED: false,
      MALWARE_SCAN_MODE: "required",
    }, {})).toThrow(/projects.*uploadScanQueue/u);
  });

  it("keeps explicit in-memory wiring available outside production", () => {
    expect(() => assertProductionDependencies({
      NODE_ENV: "test",
      PAYMENT_MODE: "sandbox",
      CHARACTER_RIG_ENABLED: false,
      MALWARE_SCAN_MODE: "disabled",
    }, {})).not.toThrow();
  });
});
