import {
  characterCanonicalViews,
  characterRequiredFrontalBodyParts,
  characterRequiredHeadParts,
  type CharacterBible,
  type CharacterCanonicalView,
  type CharacterGenerationAttempt,
  type CharacterIdentityModelVersion,
  type CharacterReferenceAsset,
  type CharacterRigVersion,
} from "@motionprep/contracts";
import { useEffect, useMemo, useState } from "react";
import {
  addCurrentSourceCharacterReference,
  approveCharacterBible,
  bootstrapCharacterIdentity,
  compileCharacterRig,
  getCharacterRigStudio,
  queueCharacterGeneration,
  reviewCharacterGeneration,
  saveCharacterBibleDraft,
} from "../../lib/api/character-rig-client";
import { angleToView, splitLines, type StudioStage } from "./CharacterStudioShared";

interface CharacterStudioControllerOptions {
  projectId: string;
  sourceVersionId: string;
  canvasSize: { width: number; height: number } | undefined;
  onNotify: (message: string) => void;
}

const defaultReviewReason =
  "تتطابق الهوية والنسب والملامح مع حزمة المراجع المعتمدة.";

export function useCharacterStudioController({
  projectId,
  sourceVersionId,
  canvasSize,
  onNotify,
}: CharacterStudioControllerOptions) {
  const [stage, setStage] = useState<StudioStage>("bible");
  const [bible, setBible] = useState<CharacterBible | null>(null);
  const [references, setReferences] = useState<CharacterReferenceAsset[]>([]);
  const [identityModel, setIdentityModel] =
    useState<CharacterIdentityModelVersion | null>(null);
  const [generations, setGenerations] =
    useState<CharacterGenerationAttempt[]>([]);
  const [rig, setRig] = useState<CharacterRigVersion | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [displayName, setDisplayName] = useState("");
  const [identityDescription, setIdentityDescription] = useState("");
  const [negativeConstraints, setNegativeConstraints] = useState("");
  const [distinguishingFeatures, setDistinguishingFeatures] = useState("");
  const [outlineColor, setOutlineColor] = useState("#111827");
  const [headRatio, setHeadRatio] = useState(0.2);
  const [shoulderRatio, setShoulderRatio] = useState(0.25);
  const [eyeRatio, setEyeRatio] = useState(0.22);
  const [rightsConfirmed, setRightsConfirmed] = useState(false);
  const [referenceView, setReferenceView] =
    useState<CharacterCanonicalView>("frontal");
  const [angle, setAngle] = useState(0);
  const [generationKind, setGenerationKind] = useState<"view" | "part">("view");
  const [partName, setPartName] = useState<string>(characterRequiredHeadParts[0]);
  const [reviewReason, setReviewReason] = useState(defaultReviewReason);

  useEffect(() => {
    const controller = new AbortController();
    void getCharacterRigStudio(projectId, controller.signal)
      .then((state) => {
        setBible(state.bible);
        setReferences(state.references);
        setIdentityModel(state.identityModel);
        setGenerations(state.generations);
        setRig(state.rig);
        if (!state.bible) return;
        setDisplayName(state.bible.displayName);
        setIdentityDescription(state.bible.identityDescription);
        setNegativeConstraints(state.bible.negativeConstraints.join("\n"));
        setDistinguishingFeatures(state.bible.distinguishingFeatures.join("\n"));
        setHeadRatio(state.bible.proportions.headToBodyHeightRatio);
        setShoulderRatio(state.bible.proportions.shoulderToBodyHeightRatio);
        setEyeRatio(state.bible.proportions.eyeSpacingToFaceWidthRatio);
        setOutlineColor(
          state.bible.palette.find((entry) => entry.role === "outline")?.color ??
            "#111827",
        );
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(errorMessage(caught, "تعذر فتح Character Studio."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [projectId]);

  const presentViews = useMemo(
    () =>
      new Set(
        references.flatMap((reference) =>
          reference.canonicalView ? [reference.canonicalView] : [],
        ),
      ),
    [references],
  );
  const distinctReferenceCount = useMemo(
    () => new Set(references.map((reference) => reference.artifact.sha256)).size,
    [references],
  );
  const activeView = angleToView(angle);
  const reviewCandidate = generations.find(
    (attempt) => attempt.status === "needs-review" && attempt.outputArtifact,
  );
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
  const requiredPartCount =
    characterCanonicalViews.length * characterRequiredHeadParts.length +
    characterRequiredFrontalBodyParts.length;
  const bibleComplete = Boolean(
    displayName.trim().length >= 2 &&
      identityDescription.trim().length >= 20 &&
      splitLines(negativeConstraints).length > 0 &&
      splitLines(distinguishingFeatures).length > 0,
  );

  async function saveBible() {
    await submit(async () => {
      const saved = await saveCharacterBibleDraft(projectId, {
        bibleId: bible?.id ?? null,
        expectedRevision: bible?.revision ?? null,
        displayName,
        identityDescription,
        negativeConstraints: splitLines(negativeConstraints),
        distinguishingFeatures: splitLines(distinguishingFeatures),
        proportions: {
          headToBodyHeightRatio: headRatio,
          shoulderToBodyHeightRatio: shoulderRatio,
          eyeSpacingToFaceWidthRatio: eyeRatio,
          notes: [],
        },
        palette: [
          {
            id:
              bible?.palette.find((entry) => entry.role === "outline")?.id ??
              crypto.randomUUID(),
            label: "Outline",
            role: "outline",
            color: outlineColor as `#${string}`,
          },
        ],
        materials: bible?.materials ?? [],
      });
      setBible(saved);
      onNotify("تم حفظ Character Bible بإصدار قابل للتدقيق.");
    }, "تعذر حفظ Character Bible.");
  }

  async function approveBible() {
    if (!bible) return;
    await submit(async () => {
      const approved = await approveCharacterBible(projectId, bible.id, bible.revision);
      setBible(approved);
      onNotify("تم قفل Character Bible واعتماد الهوية.");
      setStage("references");
    }, "تعذر اعتماد Character Bible.");
  }

  async function addReference() {
    if (!bible || !rightsConfirmed) return;
    await submit(async () => {
      const reference = await addCurrentSourceCharacterReference(projectId, {
        bibleId: bible.id,
        sourceVersionId,
        role: references.length === 0 ? "identity-primary" : "canonical-view",
        canonicalView: referenceView,
        rightsClassification: "owned-by-user",
      });
      setReferences((current) => [...current, reference]);
      setRightsConfirmed(false);
      onNotify("تم نسخ المصدر إلى حزمة المراجع المعزولة.");
    }, "تعذر إضافة المرجع.");
  }

  async function buildIdentityModel() {
    if (!bible) return;
    await submit(async () => {
      const result = await bootstrapCharacterIdentity(projectId, bible.id);
      setIdentityModel(result.modelVersion);
      onNotify("تم إرسال نموذج الهوية الخاص إلى عامل المعالجة.");
    }, "تعذر بدء بناء نموذج الهوية.");
  }

  async function generateView() {
    if (!bible || !identityModel || identityModel.status !== "ready") return;
    await submit(async () => {
      const result = await queueCharacterGeneration(projectId, {
        bibleId: bible.id,
        identityModelVersionId: identityModel.id,
        target:
          generationKind === "view"
            ? { kind: "canonical-view", view: activeView }
            : { kind: "part", view: activeView, partName: effectivePartName },
        angleDegrees: angle,
        seed: crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff,
      });
      setGenerations((current) => [
        result.attempt,
        ...current.filter((attempt) => attempt.id !== result.attempt.id),
      ]);
      onNotify("تمت إضافة الزاوية إلى طابور التوليد المقيد بالهوية.");
      setStage("compare");
    }, "تعذر بدء توليد الزاوية.");
  }

  async function compileRig() {
    if (!bible || !canvasSize) return;
    await submit(async () => {
      const result = await compileCharacterRig(projectId, {
        bibleId: bible.id,
        ...canvasSize,
      });
      setRig(result.rig);
      onNotify("تم إرسال الـRig المكتمل لبناء PSD هرمي وmanifest متحقق.");
    }, "تعذر بدء بناء PSD.");
  }

  async function reviewGeneration(
    attempt: CharacterGenerationAttempt,
    decision: "approved" | "rejected" | "changes-requested",
  ) {
    if (reviewReason.trim().length < 3) return;
    await submit(async () => {
      const result = await reviewCharacterGeneration(projectId, attempt.id, {
        decision,
        reason: reviewReason.trim(),
      });
      setGenerations((current) =>
        current.map((candidate) =>
          candidate.id === result.attempt.id ? result.attempt : candidate,
        ),
      );
      onNotify(
        decision === "approved"
          ? "تم اعتماد المرشح يدويًا وإقفاله لهذه الزاوية."
          : "تم تسجيل قرار المراجعة دون تغيير المرجع الأصلي.",
      );
    }, "تعذر تسجيل قرار المراجعة.");
  }

  async function submit(action: () => Promise<void>, fallback: string) {
    setSubmitting(true);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught, fallback));
    } finally {
      setSubmitting(false);
    }
  }

  return {
    stage,
    setStage,
    bible,
    references,
    identityModel,
    generations,
    rig,
    loading,
    submitting,
    error,
    displayName,
    setDisplayName,
    identityDescription,
    setIdentityDescription,
    negativeConstraints,
    setNegativeConstraints,
    distinguishingFeatures,
    setDistinguishingFeatures,
    outlineColor,
    setOutlineColor,
    headRatio,
    setHeadRatio,
    shoulderRatio,
    setShoulderRatio,
    eyeRatio,
    setEyeRatio,
    rightsConfirmed,
    setRightsConfirmed,
    referenceView,
    setReferenceView,
    angle,
    setAngle,
    generationKind,
    setGenerationKind,
    partName: effectivePartName,
    setPartName,
    reviewReason,
    setReviewReason,
    presentViews,
    distinctReferenceCount,
    activeView,
    reviewCandidate,
    approvedViews,
    requiredParts,
    approvedPartKeys,
    requiredPartCount,
    bibleComplete,
    saveBible,
    approveBible,
    addReference,
    buildIdentityModel,
    generateView,
    compileRig,
    reviewGeneration,
  };
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
