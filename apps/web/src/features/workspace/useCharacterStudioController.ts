import type {
  CharacterBible,
  CharacterJob,
  CharacterReferenceAsset,
  CharacterRigVersion,
} from "@motionprep/contracts";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  addCurrentSourceCharacterReference,
  approveCharacterBible,
  compileCharacterRig,
  reviewCharacterRig,
  saveCharacterBibleDraft,
  type CharacterRigStudioState,
} from "../../lib/api/character-rig-client";
import { characterBibleDraftInput } from "./CharacterStudioBible";
import { splitLines, type StudioStage } from "./CharacterStudioShared";
import {
  characterStudioErrorMessage,
  defaultCharacterReviewReason,
  type CharacterStudioControllerOptions,
} from "./characterStudioControllerSupport";
import { useCharacterBibleDirty } from "./useCharacterBibleDirty";
import { useCharacterStudioPolling } from "./useCharacterStudioPolling";

export function useCharacterStudioController({
  projectId,
  sourceVersionId,
  canvasSize,
  onNotify,
}: CharacterStudioControllerOptions) {
  const [stage, setStage] = useState<StudioStage>("bible");
  const [bible, setBible] = useState<CharacterBible | null>(null);
  const [references, setReferences] = useState<CharacterReferenceAsset[]>([]);
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
  const [reviewReason, setReviewReason] = useState(defaultCharacterReviewReason);
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
  const hasPendingWork = jobs.some((job) =>
    ["queued", "processing", "verifying"].includes(job.status),
  );
  useCharacterStudioPolling({
    projectId,
    active: hasPendingWork,
    onState: applyRemoteState,
    onInitialError: (caught) =>
      setError(characterStudioErrorMessage(caught, "تعذر فتح استوديو تجهيز الشخصية.")),
    onLoadingChange: setLoading,
  });

  const bibleComplete = useMemo(
    () =>
      displayName.trim().length >= 2 &&
      identityDescription.trim().length >= 20 &&
      splitLines(negativeConstraints).length > 0 &&
      splitLines(distinguishingFeatures).length > 0,
    [
      displayName,
      identityDescription,
      negativeConstraints,
      distinguishingFeatures,
    ],
  );
  const latestCompileJob = jobs.find((job) => job.type === "compile-rig");

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
      onNotify("تم حفظ بيانات الشخصية دون إنشاء أي محتوى بصري جديد.");
    }, "تعذر حفظ بيانات الشخصية.");
  }

  async function approveBible() {
    await submit(async () => {
      const reviewable = !bible || bibleDirty ? await persistBibleDraft() : bible;
      if (reviewable.status === "approved") return;
      const approved = await approveCharacterBible(
        projectId,
        reviewable.id,
        reviewable.revision,
      );
      setBible(approved);
      hydratedBibleIdRef.current = approved.id;
      onNotify("تم اعتماد بيانات الشخصية؛ الصورة الأصلية ما زالت دون تغيير.");
      setStage("references");
    }, "تعذر اعتماد بيانات الشخصية.");
  }

  async function addReference() {
    if (!bible || !rightsConfirmed) return;
    await submit(async () => {
      const reference = await addCurrentSourceCharacterReference(projectId, {
        bibleId: bible.id,
        sourceVersionId,
        role: "identity-primary",
        canonicalView: "frontal",
        rightsClassification: "user-provided-private-reference",
      });
      setReferences((current) => [
        ...current.filter((item) => item.id !== reference.id),
        reference,
      ]);
      setRightsConfirmed(false);
      onNotify("تم قفل الصورة الحالية كمصدر بصري وحيد ببصمة رقمية.");
      setStage("rig");
    }, "تعذر توثيق الصورة الأصلية.");
  }

  async function compileRig() {
    if (!bible || !canvasSize) return;
    await submit(async () => {
      const result = await compileCharacterRig(projectId, {
        bibleId: bible.id,
        sourceVersionId,
        ...canvasSize,
      });
      setRig(result.rig);
      setJobs((current) => [
        result.job,
        ...current.filter((job) => job.id !== result.job.id),
      ]);
      onNotify("بدأ بناء PSD من طبقات المصدر مع تحقق بكسلي إلزامي.");
    }, "تعذر بدء بناء PSD من المصدر.");
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
          ? "تم اعتماد ملف المصدر المطابق."
          : "تم رفض الملف وإبقاؤه خارج التصدير المعتمد.",
      );
    }, "تعذر تسجيل قرار مراجعة الملف.");
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
    rig,
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
    reviewReason,
    setReviewReason,
    bibleComplete,
    bibleDirty,
    saveBible,
    approveBible,
    addReference,
    compileRig,
    reviewRig,
  };
}
