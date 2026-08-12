import type { CharacterQualityReport } from "@motionprep/contracts";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  defaultCharacterQualityThresholds,
  evaluateCharacterQuality,
} from "./character-quality-policy.js";

const passing: CharacterQualityReport = {
  thresholdsSchemaVersion: 1,
  landmarkMeanHeadWidthRatio: 0.02,
  landmarkCriticalPointHeadWidthRatio: 0.04,
  proportionDeviationRatio: 0.03,
  paletteMeanDeltaE00: 3,
  heroMaterialDeltaE00: 5,
  outsideMaskChangedPixelRatio: 0,
  severeDefects: [],
  passedAutomatedGate: false,
};

describe("evaluateCharacterQuality", () => {
  it("matches the repository quality configuration", async () => {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const configured = JSON.parse(
      await readFile(
        resolve(root, "config/character-rig-quality-thresholds.json"),
        "utf8",
      ),
    ) as {
      schemaVersion: number;
      landmarks: {
        meanHeadWidthRatioMax: number;
        criticalPointHeadWidthRatioMax: number;
      };
      proportions: { maxDeviationRatio: number };
      palette: { meanDeltaE00Max: number; heroMaterialDeltaE00Max: number };
      partRegeneration: { outsideMaskChangedPixelRatioMax: number };
      rig: { severeDefectsMax: number };
    };
    expect(defaultCharacterQualityThresholds).toEqual({
      schemaVersion: configured.schemaVersion,
      landmarkMeanHeadWidthRatioMax: configured.landmarks.meanHeadWidthRatioMax,
      landmarkCriticalPointHeadWidthRatioMax:
        configured.landmarks.criticalPointHeadWidthRatioMax,
      proportionDeviationRatioMax: configured.proportions.maxDeviationRatio,
      paletteMeanDeltaE00Max: configured.palette.meanDeltaE00Max,
      heroMaterialDeltaE00Max: configured.palette.heroMaterialDeltaE00Max,
      outsideMaskChangedPixelRatioMax:
        configured.partRegeneration.outsideMaskChangedPixelRatioMax,
      severeDefectsMax: configured.rig.severeDefectsMax,
    });
  });

  it("computes the gate independently of a provider claim", () => {
    expect(
      evaluateCharacterQuality(passing, {
        kind: "canonical-view",
        view: "frontal",
      }).passedAutomatedGate,
    ).toBe(true);
    expect(
      evaluateCharacterQuality(
        { ...passing, paletteMeanDeltaE00: 3.01, passedAutomatedGate: true },
        { kind: "canonical-view", view: "frontal" },
      ).passedAutomatedGate,
    ).toBe(false);
  });

  it("fails closed for missing metrics, severe defects, and out-of-mask repair", () => {
    expect(
      evaluateCharacterQuality(
        { ...passing, landmarkMeanHeadWidthRatio: null },
        { kind: "canonical-view", view: "left-profile" },
      ).passedAutomatedGate,
    ).toBe(false);
    expect(
      evaluateCharacterQuality(
        { ...passing, severeDefects: ["identity-drift"] },
        { kind: "part", view: "frontal", partName: "mouth" },
      ).passedAutomatedGate,
    ).toBe(false);
    expect(
      evaluateCharacterQuality(
        { ...passing, outsideMaskChangedPixelRatio: 0.0001 },
        { kind: "masked-repair", view: "frontal", partName: "mouth" },
      ).passedAutomatedGate,
    ).toBe(false);
  });
});
