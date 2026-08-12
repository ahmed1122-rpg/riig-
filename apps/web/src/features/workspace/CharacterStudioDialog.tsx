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
import { Dialog } from "../../shared/Dialog";
import { Icon } from "../../shared/Icon";
import {
  addCurrentSourceCharacterReference,
  approveCharacterBible,
  bootstrapCharacterIdentity,
  characterGenerationArtifactUrl,
  compileCharacterRig,
  getCharacterRigStudio,
  queueCharacterGeneration,
  reviewCharacterGeneration,
  saveCharacterBibleDraft,
} from "../../lib/api/character-rig-client";
import {
  angleToView,
  characterViewLabels as viewLabels,
  RatioInput,
  splitLines,
  studioStages as stages,
  type StudioStage,
} from "./CharacterStudioShared";

interface CharacterStudioDialogProps {
  projectId: string;
  sourceVersionId: string;
  sourcePreviewUrl?: string;
  canvasSize?: { width: number; height: number };
  onClose: () => void;
  onNotify: (message: string) => void;
}

export function CharacterStudioDialog({
  projectId,
  sourceVersionId,
  sourcePreviewUrl,
  canvasSize,
  onClose,
  onNotify,
}: CharacterStudioDialogProps) {
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
  const [reviewReason, setReviewReason] = useState(
    "تطابق الهوية والنسب والملامح مع حزمة المراجع المعتمدة.",
  );

  useEffect(() => {
    const controller = new AbortController();
    void getCharacterRigStudio(projectId, controller.signal)
      .then((state) => {
        setBible(state.bible);
        setReferences(state.references);
        setIdentityModel(state.identityModel);
        setGenerations(state.generations);
        setRig(state.rig);
        if (state.bible) {
          setDisplayName(state.bible.displayName);
          setIdentityDescription(state.bible.identityDescription);
          setNegativeConstraints(state.bible.negativeConstraints.join("\n"));
          setDistinguishingFeatures(
            state.bible.distinguishingFeatures.join("\n"),
          );
          setHeadRatio(state.bible.proportions.headToBodyHeightRatio);
          setShoulderRatio(
            state.bible.proportions.shoulderToBodyHeightRatio,
          );
          setEyeRatio(state.bible.proportions.eyeSpacingToFaceWidthRatio);
          setOutlineColor(
            state.bible.palette.find((entry) => entry.role === "outline")
              ?.color ?? "#111827",
          );
        }
      })
      .catch((caught) => {
        if (controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "تعذر فتح Character Studio.");
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

  const saveBible = async () => {
    setSubmitting(true);
    setError(undefined);
    try {
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر حفظ Character Bible.");
    } finally {
      setSubmitting(false);
    }
  };

  const approveBible = async () => {
    if (!bible) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const approved = await approveCharacterBible(projectId, bible.id, bible.revision);
      setBible(approved);
      onNotify("تم قفل Character Bible واعتماد الهوية.");
      setStage("references");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر اعتماد Character Bible.");
    } finally {
      setSubmitting(false);
    }
  };

  const addReference = async () => {
    if (!bible || !rightsConfirmed) return;
    setSubmitting(true);
    setError(undefined);
    try {
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر إضافة المرجع.");
    } finally {
      setSubmitting(false);
    }
  };

  const buildIdentityModel = async () => {
    if (!bible) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await bootstrapCharacterIdentity(projectId, bible.id);
      setIdentityModel(result.modelVersion);
      onNotify("تم إرسال نموذج الهوية الخاص إلى عامل المعالجة.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر بدء بناء نموذج الهوية.");
    } finally {
      setSubmitting(false);
    }
  };

  const generateView = async () => {
    if (!bible || !identityModel || identityModel.status !== "ready") return;
    setSubmitting(true);
    setError(undefined);
    try {
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر بدء توليد الزاوية.");
    } finally {
      setSubmitting(false);
    }
  };

  const compileRig = async () => {
    if (!bible || !canvasSize) return;
    setSubmitting(true);
    setError(undefined);
    try {
      const result = await compileCharacterRig(projectId, {
        bibleId: bible.id,
        ...canvasSize,
      });
      setRig(result.rig);
      onNotify("تم إرسال الـRig المكتمل لبناء PSD هرمي وmanifest متحقق.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر بدء بناء PSD.");
    } finally {
      setSubmitting(false);
    }
  };

  const reviewGeneration = async (
    attempt: CharacterGenerationAttempt,
    decision: "approved" | "rejected" | "changes-requested",
  ) => {
    if (reviewReason.trim().length < 3) return;
    setSubmitting(true);
    setError(undefined);
    try {
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تسجيل قرار المراجعة.");
    } finally {
      setSubmitting(false);
    }
  };

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

  return (
    <Dialog
      title="Character Studio — Identity-locked Turntable"
      description="ثبّت هوية الشخصية أولاً، ثم أنشئ الزوايا والأجزاء تحت بوابات مقارنة ومراجعة قبل تصدير PSD هرمي."
      className="character-studio-dialog"
      onClose={onClose}
      footer={
        <>
          <span className="character-studio-status">
            {bible?.status === "approved" ? "الهوية معتمدة" : "Draft غير معتمد"}
          </span>
          <button type="button" className="button button--ghost" onClick={onClose}>
            إغلاق
          </button>
        </>
      }
    >
      <nav className="character-studio-steps" aria-label="مراحل تجهيز الشخصية">
        {stages.map((item, index) => (
          <button
            key={item.id}
            type="button"
            className={stage === item.id ? "is-active" : ""}
            onClick={() => setStage(item.id)}
          >
            <span>{index + 1}</span>{item.label}
          </button>
        ))}
      </nav>

      {loading ? (
        <div className="character-studio-loading" role="status">جاري تحميل بيانات الهوية…</div>
      ) : (
        <div className="character-studio-workbench">
          <aside className="character-reference-preview">
            <div>
              {sourcePreviewUrl ? (
                <img src={sourcePreviewUrl} alt="المصدر الحالي للشخصية" />
              ) : (
                <Icon name="image" size={36} />
              )}
            </div>
            <strong>{bible?.displayName || displayName || "الشخصية الحالية"}</strong>
            <small>{distinctReferenceCount} أصل مميز · {presentViews.size}/5 زوايا مرجعية</small>
            <small>نموذج الهوية: {identityModel?.status ?? "غير مبني"}</small>
            <ol className="canonical-view-strip">
              {characterCanonicalViews.map((view) => (
                <li key={view} className={presentViews.has(view) ? "is-ready" : ""}>
                  <span>{presentViews.has(view) ? "✓" : "○"}</span>{viewLabels[view]}
                </li>
              ))}
            </ol>
          </aside>

          <section className="character-studio-stage">
            {stage === "bible" && (
              <div className="character-bible-form">
                <header><strong>Character Bible</strong><small>المصدر الوحيد لتعريف الملامح والنسب والألوان</small></header>
                <label><span>اسم الشخصية</span><input value={displayName} disabled={bible?.status === "approved"} onChange={(event) => setDisplayName(event.target.value)} /></label>
                <label className="is-wide"><span>وصف الهوية البصرية</span><textarea value={identityDescription} disabled={bible?.status === "approved"} onChange={(event) => setIdentityDescription(event.target.value)} rows={4} /></label>
                <label><span>سمات لا يجوز تغييرها — سطر لكل سمة</span><textarea value={distinguishingFeatures} disabled={bible?.status === "approved"} onChange={(event) => setDistinguishingFeatures(event.target.value)} rows={4} /></label>
                <label><span>قيود سلبية — سطر لكل قيد</span><textarea value={negativeConstraints} disabled={bible?.status === "approved"} onChange={(event) => setNegativeConstraints(event.target.value)} rows={4} /></label>
                <div className="character-proportions is-wide">
                  <RatioInput label="الرأس ÷ طول الجسم" value={headRatio} disabled={bible?.status === "approved"} onChange={setHeadRatio} />
                  <RatioInput label="الكتف ÷ طول الجسم" value={shoulderRatio} disabled={bible?.status === "approved"} onChange={setShoulderRatio} />
                  <RatioInput label="تباعد العينين ÷ عرض الوجه" value={eyeRatio} disabled={bible?.status === "approved"} onChange={setEyeRatio} />
                  <label><span>لون الخط الأساسي</span><input type="color" value={outlineColor} disabled={bible?.status === "approved"} onChange={(event) => setOutlineColor(event.target.value)} /></label>
                </div>
                {bible?.status !== "approved" && (
                  <div className="character-stage-actions is-wide">
                    <button type="button" className="button button--ghost" disabled={submitting || !bibleComplete} onClick={() => void saveBible()}><Icon name="refresh" size={15} />حفظ Draft</button>
                    <button type="button" className="button button--primary" disabled={submitting || !bible || !bibleComplete} onClick={() => void approveBible()}><Icon name="lock" size={15} />اعتماد وقفل الهوية</button>
                  </div>
                )}
              </div>
            )}

            {stage === "references" && (
              <div className="character-reference-stage">
                <header><strong>Canonical Reference Pack</strong><small>كل أصل محفوظ مع بصمته وتصنيف حقوقه</small></header>
                <label><span>زاوية المصدر الحالي</span><select value={referenceView} onChange={(event) => setReferenceView(event.target.value as CharacterCanonicalView)}>{characterCanonicalViews.map((view) => <option key={view} value={view}>{viewLabels[view]}</option>)}</select></label>
                <label className="rights-attestation"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /><span>أؤكد أنني أملك هذا الأصل أو لدي حق استخدامه لتجهيز نموذج الشخصية.</span></label>
                <button type="button" className="button button--primary" disabled={submitting || !bible || bible.status !== "approved" || !rightsConfirmed} onClick={() => void addReference()}><Icon name="plus" size={15} />إضافة المصدر الحالي كمرجع</button>
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={
                    submitting ||
                    !bible ||
                    bible.status !== "approved" ||
                    distinctReferenceCount < 2 ||
                    ["training", "ready"].includes(identityModel?.status ?? "")
                  }
                  onClick={() => void buildIdentityModel()}
                >
                  <Icon name="shieldCheck" size={15} />
                  بناء نموذج الهوية الخاص
                </button>
                <ul className="character-reference-list">{references.map((reference) => <li key={reference.id}><span>{viewLabels[reference.canonicalView ?? "frontal"]}</span><strong>{reference.role === "identity-primary" ? "مرجع الهوية الرئيسي" : "مرجع زاوية"}</strong><small>{reference.width}×{reference.height} · {reference.artifact.sha256.slice(0, 10)}…</small></li>)}</ul>
              </div>
            )}

            {stage === "turntable" && (
              <div className="character-turntable-stage">
                <header><strong>Controlled Turntable</strong><small>التوليد الحر غير مسموح؛ كل زاوية ترتبط بأقرب وضع قياسي</small></header>
                <div className="turntable-dial"><span style={{ transform: `rotate(${angle}deg)` }}><Icon name="image" size={56} /></span><b>{angle}°</b></div>
                <label><span>زاوية الكاميرا: {angle}° — {viewLabels[activeView]}</span><input type="range" min={-90} max={90} step={1} value={angle} onChange={(event) => setAngle(Number(event.target.value))} /></label>
                <div className="turntable-presets">{([-90, -45, 0, 45, 90] as const).map((value) => <button key={value} type="button" className={angle === value ? "is-active" : ""} onClick={() => setAngle(value)}>{value}°</button>)}</div>
                <div className="character-generation-controls">
                  <label><span>نوع الناتج</span><select value={generationKind} onChange={(event) => setGenerationKind(event.target.value as "view" | "part")}><option value="view">زاوية مرجعية كاملة</option><option value="part">جزء Rig شفاف</option></select></label>
                  {generationKind === "part" && <label><span>الجزء المطلوب</span><select value={effectivePartName} onChange={(event) => setPartName(event.target.value)}>{requiredParts.map((part) => <option key={part} value={part}>{part}</option>)}</select></label>}
                </div>
                <p className="character-gate-note"><Icon name="shieldCheck" size={16} />يتطلب التوليد مرجعين معتمدين على الأقل وIdentity Model جاهزاً. لا يتم اعتماد أي صورة تلقائياً.</p>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={submitting || identityModel?.status !== "ready"}
                  title={identityModel?.status === "ready" ? undefined : "يتطلب نموذج هوية جاهزًا"}
                  onClick={() => void generateView()}
                ><Icon name="spark" size={15} />{generationKind === "view" ? "توليد زاوية مضبوطة" : "توليد جزء Rig"}</button>
                {generations.length > 0 && (
                  <ul className="character-generation-list">
                    {generations.slice(0, 5).map((attempt) => (
                      <li key={attempt.id}>
                        <span>{attempt.target.kind === "canonical-view" ? viewLabels[attempt.target.view] : attempt.target.partName}</span>
                        <strong>{attempt.status}</strong>
                        <small>{attempt.qualityReport?.passedAutomatedGate ? "اجتاز البوابة الآلية" : attempt.failureCode ?? "بانتظار العامل"}</small>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {stage === "compare" && (
              <div className="character-comparison-stage">
                <header><strong>Identity comparison & masked repair</strong><small>مقارنة المعالم والنسب واللوحة قبل تدخل المراجع</small></header>
                <div className="comparison-placeholder">
                  <div>{sourcePreviewUrl ? <img src={sourcePreviewUrl} alt="مرجع الهوية" /> : "المرجع"}</div>
                  <div>{reviewCandidate ? <img src={characterGenerationArtifactUrl(projectId, reviewCandidate.id)} alt="مرشح ينتظر المراجعة" /> : "لا يوجد مرشح جاهز للمراجعة"}</div>
                  <div>خريطة الفروق الكمية</div>
                </div>
                <ul><li>متوسط انحراف المعالم ≤ 2% من عرض الرأس</li><li>انحراف النسب ≤ 3%</li><li>متوسط ΔE00 للألوان ≤ 3</li><li>الإصلاح المقنّع: صفر تغيّر خارج القناع</li></ul>
                <label><span>سبب قرار المراجعة</span><textarea rows={3} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label>
                <div className="character-stage-actions">
                  <button type="button" className="button button--ghost" disabled>إصلاح الجزء المحدد فقط</button>
                  <button type="button" className="button button--ghost" disabled={submitting || !reviewCandidate} onClick={() => reviewCandidate && void reviewGeneration(reviewCandidate, "rejected")}>رفض</button>
                  <button type="button" className="button button--primary" disabled={submitting || !reviewCandidate || reviewReason.trim().length < 3} onClick={() => reviewCandidate && void reviewGeneration(reviewCandidate, "approved")}>اعتماد المرشح</button>
                </div>
              </div>
            )}

            {stage === "rig" && (
              <div className="character-rig-stage">
                <header><strong>Hierarchical Rig compiler</strong><small>خمس مجموعات زوايا وأجزاء رأس وجسم مسماة</small></header>
                <pre>{`+Character\n  +Frontal\n    +Head · +Eyes · +Brows · +Nose · +Mouth\n    +Torso · +Arms · +Hands · +Legs\n  +Left Quarter · +Left Profile\n  +Right Quarter · +Right Profile`}</pre>
                <p className="character-gate-note"><Icon name="packageCheck" size={16} />يصدر المترجم RGB/8-bit PSD وmanifest، ويرفض أي جزء مطلوب مفقود. الزوايا المعتمدة: {approvedViews.size}/5 · أجزاء الـRig: {approvedPartKeys.size}/{requiredPartCount}.</p>
                {rig && <p>Rig v{rig.version} · {rig.status}</p>}
                <button type="button" className="button button--primary" disabled={submitting || !canvasSize || approvedPartKeys.size < requiredPartCount} onClick={() => void compileRig()}>بناء PSD النهائي</button>
              </div>
            )}
          </section>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}
