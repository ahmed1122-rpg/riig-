import { Icon } from "../../shared/Icon";
import type { ProjectMode } from "../../types";

export type UploadState = "empty" | "validating" | "uploading" | "paused" | "verifying" | "ready" | "error";

interface SourceUploadStatusProps {
  mode: ProjectMode;
  fileName: string;
  version: number;
  state: UploadState;
  progress: number;
  detailsOpen: boolean;
  error?: string;
  hash?: string;
  onChoose: () => void;
  onToggleDetails: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

const labels: Record<UploadState, string> = {
  empty: "اختر ملف المصدر",
  validating: "التحقق من الملف",
  uploading: "رفع المصدر",
  paused: "الرفع متوقف",
  verifying: "التحقق من النسخة",
  ready: "المصدر جاهز",
  error: "تعذر تجهيز الملف",
};

export function SourceUploadStatus({
  mode,
  fileName,
  version,
  state,
  progress,
  detailsOpen,
  error,
  hash,
  onChoose,
  onToggleDetails,
  onCancel,
  onRetry,
}: SourceUploadStatusProps) {
  const active = !["empty", "ready", "error"].includes(state);

  return (
    <div className="pro-source-status">
      <button className="pro-source-file" type="button" onClick={onChoose}>
        <span className="source-icon"><Icon name={mode === "image" ? "image" : "scan"} size={17} /></span>
        <span>
          <strong dir="ltr">{fileName}</strong>
          <small>{mode === "image" ? "ملف واحد · 30 MB · حتى 15 طبقة" : "ملف PDF واحد · 30 MB · طبقات غير محدودة"}</small>
        </span>
        {version > 0 && <span className="pro-source-version">v{version}</span>}
        <span className="replace-source">{state === "empty" ? "اختيار" : "استبدال"}</span>
      </button>

      <button className={`pro-upload-pill is-${state}`} type="button" onClick={onToggleDetails} aria-expanded={detailsOpen}>
        {active && <i className="pro-spinner" />}
        {state === "ready" && <Icon name="check" size={13} />}
        {state === "error" && <Icon name="warning" size={13} />}
        <span>{labels[state]}</span>
        {state !== "empty" && <b dir="ltr">{progress}%</b>}
        <Icon name="chevron" size={13} />
      </button>

      {detailsOpen && (
        <section className="pro-upload-popover" aria-label="حالة رفع الملف">
          <header><span><strong>{labels[state]}</strong><small>عملية واحدة · ملف واحد</small></span>{state !== "empty" && <b dir="ltr">{progress}%</b>}</header>
          <div className="pro-upload-track"><i style={{ width: `${progress}%` }} /></div>
          {state === "uploading" && <p><span>2.8 MB/s</span><span>متبقٍ نحو 8 ثوانٍ</span></p>}
          {state === "verifying" && <p><span>فحص سلامة الملف</span><span>SHA-256</span></p>}
          {state === "ready" && <p className="is-success"><Icon name="badgeCheck" size={13} /> المصدر جاهز · بصمة SHA-256: {hash ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : "بانتظار رفع حقيقي"}</p>}
          {state === "empty" && <p><span>لم يبدأ الرفع</span><span>اختر ملفًا للمتابعة</span></p>}
          {state === "error" && <p className="is-error"><Icon name="warning" size={13} /> {error}</p>}
          <footer>
            {active && <button type="button" onClick={onCancel}>إلغاء</button>}
            {state === "error" && <button type="button" onClick={onRetry}><Icon name="refresh" size={13} /> إعادة المحاولة</button>}
            {state === "ready" && <button type="button" onClick={onChoose}><Icon name="refresh" size={13} /> نسخة مصدر جديدة</button>}
            {state === "empty" && <button type="button" onClick={onChoose}><Icon name="upload" size={13} /> اختيار المصدر</button>}
          </footer>
        </section>
      )}
    </div>
  );
}
