import { Dialog } from "../../shared/Dialog";
import { Icon } from "../../shared/Icon";
import { characterRigArtifactUrl } from "../../lib/api/character-rig-client";
import {
  RatioInput,
  studioStatusLabel,
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
    stage, setStage, bible, references, rig, latestCompileJob, loading,
    submitting, error, displayName, setDisplayName, identityDescription,
    setIdentityDescription, negativeConstraints, setNegativeConstraints,
    distinguishingFeatures, setDistinguishingFeatures, outlineColor,
    setOutlineColor, headRatio, setHeadRatio, shoulderRatio, setShoulderRatio,
    eyeRatio, setEyeRatio, rightsConfirmed, setRightsConfirmed,
    reviewReason, setReviewReason, bibleComplete, bibleDirty, saveBible,
    approveBible, addReference, compileRig, reviewRig,
  } = useCharacterStudioController({
    projectId,
    sourceVersionId,
    canvasSize,
    onNotify,
  });
  const currentSourceReference = references.find(
    (reference) =>
      reference.role === "identity-primary" &&
      reference.sourceVersionId === sourceVersionId,
  );
  const sourceLayerCount =
    rig?.nodes.filter((node) => node.kind === "raster").length ?? 0;

  return (
    <Dialog
      title="استوديو تجهيز الشخصية — المصدر مقفول"
      description="يُجهّز التطبيق الصورة المرفوعة نفسها فقط. لا يولّد شخصية بديلة، ولا يستبدل الوجه، ولا يخترع زوايا أو أجزاء غير موجودة."
      className="character-studio-dialog"
      onClose={onClose}
      footer={
        <>
          <span className="character-studio-status">
            {currentSourceReference
              ? "المصدر الأصلي موثّق"
              : "يلزم توثيق المصدر الحالي"}
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
        <div className="character-studio-loading" role="status">
          جاري تحميل بيانات الشخصية…
        </div>
      ) : (
        <div className="character-studio-workbench">
          <aside className="character-reference-preview">
            <div>
              {sourcePreviewUrl ? (
                <img src={sourcePreviewUrl} alt="الصورة الأصلية المقفلة" />
              ) : (
                <Icon name="image" size={36} />
              )}
            </div>
            <strong>{bible?.displayName || displayName || "الشخصية الحالية"}</strong>
            <small>
              {canvasSize ? `${canvasSize.width}×${canvasSize.height}` : "الأبعاد غير متاحة"}
            </small>
            <small>
              التحقق: {currentSourceReference ? "بصمة المصدر محفوظة" : "بانتظار التوثيق"}
            </small>
            <p className="character-gate-note">
              <Icon name="shieldCheck" size={16} />
              الصورة الظاهرة هنا هي مصدر الحقيقة البصري ومرجع مقارنة التصدير.
            </p>
          </aside>

          <section className="character-studio-stage">
            {stage === "bible" && (
              <div className="character-bible-form">
                <header>
                  <strong>بيانات الشخصية</strong>
                  <small>بيانات وصفية للتنظيم والمراجعة، وليست تعليمات لتوليد صورة جديدة</small>
                </header>
                <label><span>اسم الشخصية</span><input value={displayName} disabled={bible?.status === "approved"} onChange={(event) => setDisplayName(event.target.value)} /></label>
                <label className="is-wide"><span>وصف الصورة والشخصية</span><textarea value={identityDescription} disabled={bible?.status === "approved"} onChange={(event) => setIdentityDescription(event.target.value)} rows={4} /></label>
                <label><span>سمات يجب الحفاظ عليها — سطر لكل سمة</span><textarea value={distinguishingFeatures} disabled={bible?.status === "approved"} onChange={(event) => setDistinguishingFeatures(event.target.value)} rows={4} /></label>
                <label><span>قيود التجهيز — سطر لكل قيد</span><textarea value={negativeConstraints} disabled={bible?.status === "approved"} onChange={(event) => setNegativeConstraints(event.target.value)} rows={4} /></label>
                <div className="character-proportions is-wide">
                  <RatioInput label="الرأس ÷ طول الجسم" value={headRatio} disabled={bible?.status === "approved"} onChange={setHeadRatio} />
                  <RatioInput label="الكتف ÷ طول الجسم" value={shoulderRatio} disabled={bible?.status === "approved"} onChange={setShoulderRatio} />
                  <RatioInput label="تباعد العينين ÷ عرض الوجه" value={eyeRatio} disabled={bible?.status === "approved"} onChange={setEyeRatio} />
                  <label><span>لون الخط الأساسي</span><input type="color" value={outlineColor} disabled={bible?.status === "approved"} onChange={(event) => setOutlineColor(event.target.value)} /></label>
                </div>
                {bible?.status !== "approved" && (
                  <div className="character-stage-actions is-wide">
                    <button type="button" className="button button--ghost" disabled={submitting || !bibleComplete} onClick={() => void saveBible()}><Icon name="save" size={15} />حفظ المسودة</button>
                    <button type="button" className="button button--primary" disabled={submitting || !bibleComplete} onClick={() => void approveBible()}><Icon name="lock" size={15} />{bibleDirty ? "حفظ واعتماد البيانات" : "اعتماد وقفل البيانات"}</button>
                  </div>
                )}
              </div>
            )}

            {stage === "references" && (
              <div className="character-reference-stage">
                <header>
                  <strong>توثيق الصورة الأصلية</strong>
                  <small>يُحفظ المصدر الحالي مع بصمته الرقمية لإثبات أن التصدير يعيده كما هو</small>
                </header>
                <label className="rights-attestation">
                  <input type="checkbox" checked={rightsConfirmed} disabled={Boolean(currentSourceReference)} onChange={(event) => setRightsConfirmed(event.target.checked)} />
                  <span>أؤكد أنني أملك هذه الصورة أو لدي ترخيص أو تفويض صريح لاستخدامها وتجهيزها.</span>
                </label>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={submitting || !bible || bible.status !== "approved" || !rightsConfirmed || Boolean(currentSourceReference)}
                  onClick={() => void addReference()}
                >
                  <Icon name="shieldCheck" size={15} />
                  {currentSourceReference ? "تم توثيق المصدر الحالي" : "قفل الصورة الحالية كمصدر وحيد"}
                </button>
                <p className="character-gate-note">
                  لن يُرسل هذا المسار الصورة إلى نموذج توليدي، ولن ينشئ مرجعًا ثانيًا أو زاوية مصطنعة.
                </p>
                {currentSourceReference && (
                  <ul className="character-reference-list">
                    <li>
                      <span>المصدر الأمامي الوحيد</span>
                      <strong>مطابق للإصدار الحالي</strong>
                      <small>{currentSourceReference.width}×{currentSourceReference.height} · {currentSourceReference.artifact.sha256.slice(0, 12)}…</small>
                    </li>
                  </ul>
                )}
              </div>
            )}

            {stage === "rig" && (
              <div className="character-rig-stage">
                <header>
                  <strong>تجميع طبقات المصدر</strong>
                  <small>PSD من طبقات الصورة الحالية فقط، مع تحقق بكسلي قبل الحفظ</small>
                </header>
                <pre>{`+Character\n  +Frontal\n    +Source Layer 1\n    +Source Layer 2 …`}</pre>
                <p className="character-gate-note">
                  <Icon name="packageCheck" size={16} />
                  يعيد النظام دمج الطبقات ويقارن RGBA مع الصورة المرفوعة بكسلًا ببكسل. أي اختلاف يوقف التصدير تلقائيًا.
                </p>
                <p className="character-gate-note">
                  الأجزاء المحجوبة أو غير الموجودة في الصورة لا تُخترع. فصل العين والفم واليدين يتطلب وجودها فعلًا في طبقات المصدر أو إعدادها يدويًا لاحقًا.
                </p>
                <p className="character-gate-note">
                  هذا الإصدار يُنتج PSD أماميًا محافظًا على المصدر؛ ولا يدّعي إنشاء Puppet كامل جاهز تلقائيًا داخل Adobe Character Animator.
                </p>
                {rig && (
                  <p>
                    الإصدار v{rig.version} · {studioStatusLabel(rig.status)} · {sourceLayerCount} طبقة مصدر
                  </p>
                )}
                {latestCompileJob?.status === "failed" && (
                  <p className="form-error" role="alert">
                    أوقف التحقق التصدير: {latestCompileJob.errorCode ?? "CHARACTER_RIG_COMPILATION_FAILED"}. راجع طبقات المصدر ثم أعد المحاولة.
                  </p>
                )}
                {rig?.psdArtifact && rig.manifestArtifact && (
                  <div className="character-stage-actions">
                    <a className="button button--ghost" href={characterRigArtifactUrl(projectId, rig.id, "psd")}>تنزيل PSD</a>
                    <a className="button button--ghost" href={characterRigArtifactUrl(projectId, rig.id, "manifest")}>تنزيل تقرير التطابق</a>
                  </div>
                )}
                {rig?.status === "needs-review" && (
                  <>
                    <label><span>سبب قرار المراجعة</span><textarea rows={3} value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} /></label>
                    <div className="character-stage-actions">
                      <button type="button" className="button button--ghost" disabled={submitting || reviewReason.trim().length < 3} onClick={() => void reviewRig("rejected")}>رفض الملف</button>
                      <button type="button" className="button button--primary" disabled={submitting || reviewReason.trim().length < 3} onClick={() => void reviewRig("approved")}>اعتماد الملف المطابق</button>
                    </div>
                  </>
                )}
                <button
                  type="button"
                  className="button button--primary"
                  disabled={submitting || !canvasSize || !currentSourceReference}
                  onClick={() => void compileRig()}
                >
                  بناء PSD من المصدر الحالي
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}
