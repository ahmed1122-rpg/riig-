import { Icon } from "../../shared/Icon";
import {
  MAX_IMAGE_LAYERS,
  MAX_UPLOAD_MEBIBYTES,
} from "@motionprep/contracts";
import type { ProjectMode } from "../../types";

export function EmptySourcePreview({
  mode,
  onChoose,
}: {
  mode: ProjectMode;
  onChoose: () => void;
}) {
  return (
    <section
      className="pro-empty-source"
      aria-label="ابدأ برفع المصدر"
    >
      <span>
        <Icon
          name={mode === "image" ? "image" : "scan"}
          size={32}
        />
      </span>
      <strong>
        {mode === "image"
          ? "ارفع صورة لبدء التقطيع"
          : "ارفع PDF لبدء فصل النص"}
      </strong>
      <p>
        {mode === "image"
          ? `PNG أو JPG أو WebP أو AVIF أو TIFF أو BMP · حتى ${MAX_UPLOAD_MEBIBYTES} MiB · وبحد أقصى ${MAX_IMAGE_LAYERS} طبقة`
          : `ملف PDF واحد · حتى ${MAX_UPLOAD_MEBIBYTES} MiB · بلا حد عددي للطبقات`}
      </p>
      <button
        type="button"
        className="primary-button"
        onClick={onChoose}
      >
        <Icon name="upload" size={17} /> اختيار ملف واحد
      </button>
    </section>
  );
}

export function EmptyLayerDock() {
  return (
    <aside
      className="pro-empty-layer-dock"
      aria-label="قائمة الطبقات الفارغة"
    >
      <header>
        <span>
          <Icon name="layers" size={16} /> الطبقات
        </span>
        <b>0</b>
      </header>
      <div>
        <Icon name="folder" size={25} />
        <strong>لا توجد طبقات</strong>
        <small>ستظهر الطبقات هنا بعد تجهيز المصدر.</small>
      </div>
    </aside>
  );
}
