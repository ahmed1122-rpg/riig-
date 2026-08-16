import {
  characterCanonicalViews,
  characterRequiredFrontalBodyParts,
  characterRequiredHeadParts,
  type CharacterGenerationAttempt,
  type CharacterJob,
  type CharacterReferenceAsset,
} from "@motionprep/contracts";
import { angleToView, splitLines } from "./CharacterStudioShared";

export function deriveCharacterStudioState({
  references,
  generations,
  jobs,
  angle,
  selectedGenerationId,
  partName,
  displayName,
  identityDescription,
  negativeConstraints,
  distinguishingFeatures,
}: {
  references: CharacterReferenceAsset[];
  generations: CharacterGenerationAttempt[];
  jobs: CharacterJob[];
  angle: number;
  selectedGenerationId: string | undefined;
  partName: string;
  displayName: string;
  identityDescription: string;
  negativeConstraints: string;
  distinguishingFeatures: string;
}) {
  const presentViews = new Set(
    references.flatMap((reference) =>
      reference.canonicalView ? [reference.canonicalView] : [],
    ),
  );
  const distinctReferenceCount = new Set(
    references.map((reference) => reference.artifact.sha256),
  ).size;
  const activeView = angleToView(angle);
  const reviewableGenerations = generations.filter(
    (attempt) => attempt.status === "needs-review" && attempt.outputArtifact,
  );
  const reviewCandidate =
    reviewableGenerations.find((attempt) => attempt.id === selectedGenerationId) ??
    reviewableGenerations[0];
  const approvedViews = new Set(
    generations.flatMap((attempt) =>
      attempt.status === "approved" && attempt.target.kind === "canonical-view"
        ? [attempt.target.view]
        : [],
    ),
  );
  const requiredParts = [
    ...characterRequiredHeadParts,
    ...(activeView === "frontal" ? characterRequiredFrontalBodyParts : []),
  ];
  const effectivePartName = requiredParts.includes(
    partName as (typeof requiredParts)[number],
  )
    ? partName
    : requiredParts[0]!;
  const approvedPartKeys = new Set(
    generations.flatMap((attempt) =>
      attempt.status === "approved" && attempt.target.kind === "part"
        ? [`${attempt.target.view}:${attempt.target.partName}`]
        : [],
    ),
  );
  return {
    presentViews,
    distinctReferenceCount,
    activeView,
    reviewableGenerations,
    reviewCandidate,
    approvedViews,
    requiredParts,
    effectivePartName,
    approvedPartKeys,
    requiredPartCount:
      characterCanonicalViews.length * characterRequiredHeadParts.length +
      characterRequiredFrontalBodyParts.length,
    bibleComplete:
      displayName.trim().length >= 2 &&
      identityDescription.trim().length >= 20 &&
      splitLines(negativeConstraints).length > 0 &&
      splitLines(distinguishingFeatures).length > 0,
    repairMask: references.find((reference) => reference.role === "part-mask"),
    latestCompileJob: jobs.find((job) => job.type === "compile-rig"),
  };
}
