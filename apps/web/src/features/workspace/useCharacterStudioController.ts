import {
  characterRequiredHeadParts,
  type CharacterBible,
  type CharacterCanonicalView,
  type CharacterGenerationAttempt,
  type CharacterIdentityModelVersion,
  type CharacterJob,
  type CharacterReferenceAsset,
  type CharacterReferenceRole,
  type CharacterRigVersion,
} from "@motionprep/contracts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addCurrentSourceCharacterReference,
  approveCharacterBible,
  bootstrapCharacterIdentity,
  compileCharacterRig,
  queueCharacterGeneration,
  reviewCharacterGeneration,
  reviewCharacterRig,
  saveCharacterBibleDraft,
  type CharacterRigStudioState,
} from "../../lib/api/character-rig-client";
import { type StudioStage } from "./CharacterStudioShared";
import {
  characterBibleDraftInput,
} from "./CharacterStudioBible";
import { useCharacterStudioPolling } from "./useCharacterStudioPolling";
import { deriveCharacterStudioState } from "./characterStudioDerivedState";
import {
  characterStudioErrorMessage,
  defaultCharacterReviewReason,
  type CharacterStudioControllerOptions,
} from "./characterStudioControllerSupport";
import { useCharacterBibleDirty } from "./useCharacterBibleDirty";

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
  const [jobs, setJobs] = useState<CharacterJob[]>([]);
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
  const [referenceRole, setReferenceRole] =
    useState<CharacterReferenceRole>("identity-primary");
  const [angle, setAngle] = useState(0);
  const [generationKind, setGenerationKind] = useState<"view" | "part">("view");
  const [partName, setPartName] = useState<string>(characterRequiredHeadParts[0]);
  const [reviewReason, setReviewReason] = useState(defaultCharacterReviewReason);
  const [selectedGenerationId, setSelectedGenerationId] = useState<string>();
  const bibleDirtyRef = useRef(false);
  const hydratedBibleIdRef = useRef<string | undefined>(undefined);

  const bibleDirty = useCharacterBibleDirty({
    bible,
    displayName,
    identityDescription,
    negativeConstraints,
    distinguishingFeatures,
    outlineColor,
    headRatio,
    shoulderRatio,
    eyeRatio,
  });
  bibleDirtyRef.current = bibleDirty;

  const hydrateBibleFields = useCallback((remote: CharacterBible) => {
    setDisplayName(remote.displayName);
    setIdentityDescription(remote.identityDescription);
    setNegativeConstraints(remote.negativeConstraints.join("\n"));
    setDistinguishingFeatures(remote.distinguishingFeatures.join("\n"));
    setHeadRatio(remote.proportions.headToBodyHeightRatio);
    setShoulderRatio(remote.proportions.shoulderToBodyHeightRatio);
    setEyeRatio(remote.proportions.eyeSpacingToFaceWidthRatio);
    setOutlineColor(
      remote.palette.find((entry) => entry.role === "outline")?.color ??
        "#111827",
    );
    hydratedBibleIdRef.current = remote.id;
  }, []);

  const applyRemoteState = useCallback(
    (state: CharacterRigStudioState) => {
      setBible(state.bible);
      setReferences(state.references);
      setReferenceRole((current) =>
        current === "identity-primary" &&
        state.references.some((reference) => reference.role === "identity-primary")
          ? "canonical-view"
          : current,
      );
      setIdentityModel(state.identityModel);
      setGenerations(state.generations);
      setRig(state.rig);
      setJobs(state.jobs);
      if (
        state.bible &&
        (!bibleDirtyRef.current || hydratedBibleIdRef.current !== state.bible.id)
      ) {
        hydrateBibleFields(state.bible);
      }
    },
    [hydrateBibleFields],
  );

  const hasPendingWork = Boolean(
    jobs.some((job) =>
      ["queued", "processing", "verifying"].includes(job.status),
    ),
  );
  const handleInitialError = useCallback((caught: unknown) => {
    setError(characterStudioErrorMessage(caught, "تعذر فتح استوديو تدوير الشخصية."));
  }, []);
  const handleLoadingChange = useCallback((nextLoading: boolean) => {
    setLoading(nextLoading);
  }, []);
  useCharacterStudioPolling({
    projectId,
    active: hasPendingWork,
    onState: applyRemoteState,
    onInitialError: handleInitialError,
    onLoadingChange: handleLoadingChange,
  });

  const {
    presentViews,
    distinctReferenceCount,
    activeView,
    reviewableGenerations,
    reviewCandidate,
    approvedViews,
    requiredParts,
    effectivePartName,
    approvedPartKeys,
    requiredPartCount,
    bibleComplete,
    repairMask,
    latestCompileJob,
  } = useMemo(
    () =>
      deriveCharacterStudioState({
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
      }),
    [
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
    ],
  );
  useEffect(() => {
    if (reviewCandidate && reviewCandidate.id !== selectedGenerationId) {
      setSelectedGenerationId(reviewCandidate.id);
    }
  }, [reviewCandidate, selectedGenerationId]);

  async function persistBibleDraft(): Promise<CharacterBible> {
    const saved = await saveCharacterBibleDraft(
      projectId,
      characterBibleDraftInput(bible, {
        displayName,
        identityDescription,
        negativeConstraints,
        distinguishingFeatures,
        outlineColor,
        headRatio,
        shoulderRatio,
        eyeRatio,
      }),
    );
    setBible(saved);
    hydratedBibleIdRef.current = saved.id;
    return saved;
  }

  async function saveBible() {
    await submit(async () => {
      await persistBibleDraft();
      onNotify("تم حفظ دليل هوية الشخصية بإصدار قابل للتدقيق.");
    }, "تعذر حفظ دليل هوية الشخصية.");
  }

  async function approveBible() {
    await submit(async () => {
      const reviewableBible =
        !bible || bibleDirty ? await persistBibleDraft() : bible;
      if (reviewableBible.status === "approved") return;
      const approved = await approveCharacterBible(
        projectId,
        reviewableBible.id,
        reviewableBible.revision,
      );
      setBible(approved);
      hydratedBibleIdRef.current = approved.id;
      onNotify("تم قفل دليل هوية الشخصية واعتماد الهوية.");
      setStage("references");
    }, "تعذر اعتماد دليل هوية الشخصية.");
  }

  async function addReference() {
    if (!bible || !rightsConfirmed) return;
    await submit(async () => {
      const reference = await addCurrentSourceCharacterReference(projectId, {
        bibleId: bible.id,
        sourceVersionId,
        role: referenceRole,
        canonicalView: referenceView,
        rightsClassification: "owned-by-user",
      });
      setReferences((current) => [...current, reference]);
      setRightsConfirmed(false);
      if (referenceRole === "identity-primary") {
        setReferenceRole("canonical-view");
      }
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
    if (!bible || !identityModel || identityModel.status !== "ready" || !canvasSize) return;
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
        canvas: canvasSize,
      });
      setGenerations((current) => [
        result.attempt,
        ...current.filter((attempt) => attempt.id !== result.attempt.id),
      ]);
      onNotify("تمت إضافة الزاوية إلى طابور التوليد المقيد بالهوية.");
      setStage("compare");
    }, "تعذر بدء توليد الزاوية.");
  }

  async function repairSelectedPart() {
    if (
      !bible ||
      !identityModel ||
      identityModel.status !== "ready" ||
      !canvasSize ||
      !repairMask ||
      !reviewCandidate ||
      reviewCandidate.target.kind === "canonical-view"
    ) {
      return;
    }
    const repairTarget = reviewCandidate.target;
    await submit(async () => {
      const result = await queueCharacterGeneration(projectId, {
        bibleId: bible.id,
        identityModelVersionId: identityModel.id,
        target: {
          kind: "masked-repair",
          view: repairTarget.view,
          partName: repairTarget.partName,
        },
        angleDegrees: angle,
        seed: crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff,
        canvas: canvasSize,
        maskReferenceId: repairMask.id,
      });
      setGenerations((current) => [
        result.attempt,
        ...current.filter((attempt) => attempt.id !== result.attempt.id),
      ]);
      setSelectedGenerationId(result.attempt.id);
      onNotify("تم إرسال إصلاح الجزء المقنّع مع حماية البكسلات خارج القناع.");
    }, "تعذر بدء إصلاح الجزء المقنّع.");
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

  async function reviewRig(decision: "approved" | "rejected") {
    if (!rig || reviewReason.trim().length < 3) return;
    await submit(async () => {
      const result = await reviewCharacterRig(projectId, rig.id, {
        decision,
        reason: reviewReason.trim(),
      });
      setRig(result.rig);
      onNotify(
        decision === "approved"
          ? "تم اعتماد الـRig وملفاته المتحققة نهائيًا."
          : "تم رفض الـRig وإحالته لإعادة البناء.",
      );
    }, "تعذر تسجيل قرار مراجعة الـRig.");
  }

  async function submit(action: () => Promise<void>, fallback: string) {
    setSubmitting(true);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError(characterStudioErrorMessage(caught, fallback));
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
    jobs,
    latestCompileJob,
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
    referenceRole,
    setReferenceRole,
    angle,
    setAngle,
    generationKind,
    setGenerationKind,
    partName: effectivePartName,
    setPartName,
    reviewReason,
    setReviewReason,
    selectedGenerationId,
    setSelectedGenerationId,
    presentViews,
    distinctReferenceCount,
    activeView,
    reviewableGenerations,
    reviewCandidate,
    approvedViews,
    requiredParts,
    approvedPartKeys,
    requiredPartCount,
    bibleComplete,
    bibleDirty,
    repairMask,
    saveBible,
    approveBible,
    addReference,
    buildIdentityModel,
    generateView,
    repairSelectedPart,
    compileRig,
    reviewGeneration,
    reviewRig,
  };
}
