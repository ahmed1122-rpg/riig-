import type { CharacterBible } from "@motionprep/contracts";
import type { saveCharacterBibleDraft } from "../../lib/api/character-rig-client";
import { splitLines } from "./CharacterStudioShared";

export interface CharacterBibleDraftFields {
  displayName: string;
  identityDescription: string;
  negativeConstraints: string;
  distinguishingFeatures: string;
  outlineColor: string;
  headRatio: number;
  shoulderRatio: number;
  eyeRatio: number;
}

export function characterBibleDraftInput(
  bible: CharacterBible | null,
  fields: CharacterBibleDraftFields,
): Parameters<typeof saveCharacterBibleDraft>[1] {
  return {
    bibleId: bible?.id ?? null,
    expectedRevision: bible?.revision ?? null,
    displayName: fields.displayName,
    identityDescription: fields.identityDescription,
    negativeConstraints: splitLines(fields.negativeConstraints),
    distinguishingFeatures: splitLines(fields.distinguishingFeatures),
    proportions: {
      headToBodyHeightRatio: fields.headRatio,
      shoulderToBodyHeightRatio: fields.shoulderRatio,
      eyeSpacingToFaceWidthRatio: fields.eyeRatio,
      notes: [],
    },
    palette: [
      {
        id:
          bible?.palette.find((entry) => entry.role === "outline")?.id ??
          crypto.randomUUID(),
        label: "Outline",
        role: "outline",
        color: fields.outlineColor as `#${string}`,
      },
    ],
    materials: bible?.materials ?? [],
  };
}

export function draftMatchesBible(
  bible: CharacterBible,
  draft: CharacterBibleDraftFields,
): boolean {
  return (
    bible.displayName === draft.displayName &&
    bible.identityDescription === draft.identityDescription &&
    bible.negativeConstraints.join("\n") === draft.negativeConstraints &&
    bible.distinguishingFeatures.join("\n") === draft.distinguishingFeatures &&
    (bible.palette.find((entry) => entry.role === "outline")?.color ??
      "#111827") === draft.outlineColor &&
    bible.proportions.headToBodyHeightRatio === draft.headRatio &&
    bible.proportions.shoulderToBodyHeightRatio === draft.shoulderRatio &&
    bible.proportions.eyeSpacingToFaceWidthRatio === draft.eyeRatio
  );
}
