import { useMemo } from "react";
import type { CharacterBible } from "@motionprep/contracts";
import { draftMatchesBible } from "./CharacterStudioBible";

export function useCharacterBibleDirty(input: {
  bible: CharacterBible | null | undefined;
  displayName: string;
  identityDescription: string;
  negativeConstraints: string;
  distinguishingFeatures: string;
  outlineColor: string;
  headRatio: number;
  shoulderRatio: number;
  eyeRatio: number;
}): boolean {
  return useMemo(
    () => Boolean(
      input.bible &&
      input.bible.status !== "approved" &&
      !draftMatchesBible(input.bible, input),
    ),
    [input],
  );
}
