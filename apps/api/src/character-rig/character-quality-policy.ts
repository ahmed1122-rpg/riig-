import type {
  CharacterGenerationTarget,
  CharacterQualityReport,
} from "@motionprep/contracts";

export interface CharacterQualityThresholds {
  schemaVersion: number;
  landmarkMeanHeadWidthRatioMax: number;
  landmarkCriticalPointHeadWidthRatioMax: number;
  proportionDeviationRatioMax: number;
  paletteMeanDeltaE00Max: number;
  heroMaterialDeltaE00Max: number;
  outsideMaskChangedPixelRatioMax: number;
  severeDefectsMax: number;
}

export const defaultCharacterQualityThresholds: CharacterQualityThresholds = {
  schemaVersion: 1,
  landmarkMeanHeadWidthRatioMax: 0.02,
  landmarkCriticalPointHeadWidthRatioMax: 0.04,
  proportionDeviationRatioMax: 0.03,
  paletteMeanDeltaE00Max: 3,
  heroMaterialDeltaE00Max: 5,
  outsideMaskChangedPixelRatioMax: 0,
  severeDefectsMax: 0,
};

export function evaluateCharacterQuality(
  report: CharacterQualityReport,
  target: CharacterGenerationTarget,
  thresholds: CharacterQualityThresholds = defaultCharacterQualityThresholds,
): CharacterQualityReport {
  const passed =
    report.thresholdsSchemaVersion === thresholds.schemaVersion &&
    within(report.landmarkMeanHeadWidthRatio, thresholds.landmarkMeanHeadWidthRatioMax) &&
    within(
      report.landmarkCriticalPointHeadWidthRatio,
      thresholds.landmarkCriticalPointHeadWidthRatioMax,
    ) &&
    within(report.proportionDeviationRatio, thresholds.proportionDeviationRatioMax) &&
    within(report.paletteMeanDeltaE00, thresholds.paletteMeanDeltaE00Max) &&
    within(report.heroMaterialDeltaE00, thresholds.heroMaterialDeltaE00Max) &&
    (target.kind !== "masked-repair" ||
      within(
        report.outsideMaskChangedPixelRatio,
        thresholds.outsideMaskChangedPixelRatioMax,
      )) &&
    report.severeDefects.length <= thresholds.severeDefectsMax;
  return { ...report, passedAutomatedGate: passed };
}

function within(value: number | null, maximum: number): boolean {
  return value !== null && Number.isFinite(value) && value <= maximum;
}
