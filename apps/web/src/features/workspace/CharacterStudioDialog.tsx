import {
  characterCanonicalViews,
  type CharacterCanonicalView,
  type CharacterReferenceRole,
} from "@motionprep/contracts";
import { Dialog } from "../../shared/Dialog";
import { Icon } from "../../shared/Icon";
import {
  characterGenerationArtifactUrl,
  characterRigArtifactUrl,
} from "../../lib/api/character-rig-client";
import {
  characterViewLabels as viewLabels,
  RatioInput,
  studioStages as stages,
} from "./CharacterStudioShared";
import { useCharacterStudioController } from "./useCharacterStudioController";

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
  const {
    stage, setStage, bible, references, identityModel, generations, rig,
    latestCompileJob,
    loading, submitting, error, displayName, setDisplayName,
    identityDescription, setIdentityDescription, negativeConstraints,
    setNegativeConstraints, distinguishingFeatures, setDistinguishingFeatures,
    outlineColor, setOutlineColor, headRatio, setHeadRatio, shoulderRatio,
    setShoulderRatio, eyeRatio, setEyeRatio, rightsConfirmed,
    setRightsConfirmed, referenceView, setReferenceView, referenceRole,
    setReferenceRole, angle, setAngle,
    generationKind, setGenerationKind, partName, setPartName, reviewReason,
    setReviewReason, selectedGenerationId, setSelectedGenerationId,
    presentViews, distinctReferenceCount, activeView, reviewableGenerations,
    reviewCandidate, approvedViews, requiredParts, approvedPartKeys,
    requiredPartCount, bibleComplete, bibleDirty, repairMask, saveBible,
    approveBible, addReference, buildIdentityModel, generateView,
    repairSelectedPart, compileRig, reviewGeneration, reviewRig,
  } = useCharacterStudioController({
    projectId,
    sourceVersionId,
    canvasSize,
    onNotify,
  });
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
                    <button type="button" className="button button--primary" disabled={submitting || !bibleComplete} onClick={() => void approveBible()}><Icon name="lock" size={15} />{bibleDirty ? "حفظ واعتماد الهوية" : "اعتماد وقفل الهوية"}</button>
                  </div>
                )}
              </div>
            )}

            {stage === "references" && (
              <div className="character-reference-stage">
                <header><strong>Canonical Reference Pack</strong><small>كل أصل محفوظ مع بصمته وتصنيف حقوقه</small></header>
                <label><span>نوع المرجع</span><select value={referenceRole} onChange={(event) => setReferenceRole(event.target.value as CharacterReferenceRole)}><option value="identity-primary">مرجع الهوية الرئيسي</option><option value="canonical-view">مرجع زاوية قياسية</option><option value="part-mask">قناع إصلاح جزء</option></select></label>
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
                  {generationKind === "part" && <label><span>الجزء المطلوب</span><select value={partName} onChange={(event) => setPartName(event.target.value)}>{requiredParts.map((part) => <option key={part} value={part}>{part}</option>)}</select></label>}
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
                  <div>{reviewCandidate?.qualityReport ? `Landmarks ${formatRatio(reviewCandidate.qualityReport.landmarkMeanHeadWidthRatio)} · ΔE ${formatMetric(reviewCandidate.qualityReport.paletteMeanDeltaE00)}` : "لا توجد قياسات جاهزة"}</div>
                </div>
                {reviewableGenerations.length > 1 && <label><span>المرشح قيد المراجعة</span><select value={selectedGenerationId ?? ""} onChange={(event) => setSelectedGenerationId(event.target.value)}>{reviewableGenerations.map((attempt) => <option key={attempt.id} value={attempt.id}>{attempt.target.kind === "canonical-view" ? viewLabels[attempt.target.view] : `${attempt.target.partName} · ${viewLabels[attempt.target.view]}`}</option>)}</select></label>}
                <ul><li>متوسط انحراف المعالم ≤ 2% من عرض الرأس</li><li>انحراف النسب ≤ 3%</li><li>متوسط ΔE00 للألوان ≤ 3</li><li>الإصلاح المقنّع: صفر تغيّر خارج القناع</li></ul>
                <label><span>سبب قرار المراجعة</span><textarea rows={3} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label>
                <div className="character-stage-actions">
                  <button type="button" className="button button--ghost" disabled={submitting || !repairMask || !reviewCandidate || reviewCandidate.target.kind === "canonical-view"} title={!repairMask ? "أضف مرجعًا من نوع قناع إصلاح جزء أولًا" : undefined} onClick={() => void repairSelectedPart()}>إصلاح الجزء المحدد فقط</button>
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
                {latestCompileJob?.status === "failed" && <p className="form-error" role="alert">فشل بناء الـRig: {latestCompileJob.errorCode ?? "CHARACTER_RIG_COMPILATION_FAILED"}. يمكنك تصحيح الأجزاء ثم إعادة البناء.</p>}
                {rig?.psdArtifact && rig.manifestArtifact && <div className="character-stage-actions"><a className="button button--ghost" href={characterRigArtifactUrl(projectId, rig.id, "psd")}>تنزيل PSD</a><a className="button button--ghost" href={characterRigArtifactUrl(projectId, rig.id, "manifest")}>تنزيل manifest</a></div>}
                {rig?.status === "needs-review" && <><label><span>سبب قرار مراجعة الـRig</span><textarea rows={3} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label><div className="character-stage-actions"><button type="button" className="button button--ghost" disabled={submitting || reviewReason.trim().length < 3} onClick={() => void reviewRig("rejected")}>رفض الـRig</button><button type="button" className="button button--primary" disabled={submitting || reviewReason.trim().length < 3} onClick={() => void reviewRig("approved")}>اعتماد الـRig</button></div></>}
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

function formatRatio(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(2)}%`;
}

function formatMetric(value: number | null): string {
  return value === null ? "—" : value.toFixed(2);
}
