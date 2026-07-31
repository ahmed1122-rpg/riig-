import { Icon, type IconName } from "../../shared/Icon";
import {
  MAX_IMAGE_LAYERS,
  MAX_UPLOAD_MEBIBYTES,
} from "@motionprep/contracts";

interface LandingPageProps {
  onOpenGuest: () => void;
  onOpenAuth: () => void;
}

const capabilities: Array<{
  icon: IconName;
  value: string;
  label: string;
}> = [
  { icon: "upload", value: `${MAX_UPLOAD_MEBIBYTES} MiB`, label: "حجم الملف الأقصى" },
  { icon: "layers", value: String(MAX_IMAGE_LAYERS), label: "طبقة كحد أقصى للصورة" },
  { icon: "scanText", value: "6", label: "أنماط لتقسيم نص PDF" },
  { icon: "review", value: "قبل التصدير", label: "معاينة وفحص الطبقات" },
];

const pdfModes = [
  "الحروف",
  "الكلمات",
  "الأسطر",
  "الجمل",
  "الموضوعات",
  "العناوين",
];

function Brand() {
  return (
    <span className="marketing-brand" aria-label="MotionPrep">
      <span aria-hidden="true">
        <Icon name="layers" size={21} />
      </span>
      <span>
        <strong>MotionPrep</strong>
        <small>Animation prep studio</small>
      </span>
    </span>
  );
}

function PipelineRibbon() {
  return (
    <div className="marketing-pipeline" aria-label="من المصدر إلى طبقات جاهزة ثم ملف PSD">
      <div className="pipeline-art">
        <picture>
          <img
            src="/visuals/hero-anime-studio.webp"
            width="1774"
            height="887"
            alt="استوديو رسوم يوضح انتقال صورة شخصية إلى طبقات منفصلة"
            fetchPriority="high"
          />
        </picture>
        <span className="pipeline-source-chip">
          <Icon name="image" size={15} />
          صورة أو PDF واحد
        </span>
      </div>

      <div className="layer-ribbon" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </div>

      <div className="pipeline-package">
        <span className="package-icon">
          <Icon name="packageCheck" size={27} />
        </span>
        <span>
          <small>حزمة منظمة</small>
          <strong>PSD</strong>
          <bdi>+character · +eyes · +background</bdi>
        </span>
      </div>
    </div>
  );
}

export default function LandingPage({
  onOpenGuest,
  onOpenAuth,
}: LandingPageProps) {
  return (
    <div className="marketing-page">
      <a className="skip-link" href="#marketing-main">
        انتقل إلى المحتوى
      </a>

      <header className="marketing-nav">
        <Brand />
        <nav aria-label="التنقل في الصفحة">
          <a href="#workflows">مسارا العمل</a>
          <a href="#showcase">النتيجة</a>
          <a href="#capabilities">الإمكانات</a>
        </nav>
        <div className="marketing-nav__actions">
          <button type="button" className="marketing-login" onClick={onOpenAuth}>
            <Icon name="login" size={16} />
            تسجيل الدخول
          </button>
          <button type="button" className="marketing-studio-button" onClick={onOpenGuest}>
            فتح الاستوديو كضيف
            <Icon name="arrow" size={16} />
          </button>
        </div>
      </header>

      <main id="marketing-main">
        <section className="marketing-hero" aria-labelledby="marketing-title">
          <div className="marketing-hero__copy">
            <span className="marketing-kicker">
              <i aria-hidden="true" />
              طبقات مرتبة. حركة أسرع.
            </span>
            <h1 id="marketing-title">
              حوّل صورة واحدة أو ملف PDF إلى{" "}
              <em>طبقات جاهزة للتحريك.</em>
            </h1>
            <p>
              ارفع مصدرك، راجع الفصل والتسمية، ثم صدّر حزمة منظمة لخط إنتاج
              Adobe — من دون إخفاء القيود أو تخمين ما حدث للصورة.
            </p>
            <div className="marketing-hero__actions">
              <button
                type="button"
                className="marketing-primary-cta"
                onClick={onOpenGuest}
              >
                <Icon name="spark" size={19} />
                جرّب مساحة التجهيز
              </button>
              <button
                type="button"
                className="marketing-secondary-cta"
                onClick={onOpenAuth}
              >
                لدي حساب
                <Icon name="login" size={17} />
              </button>
            </div>
            <p className="marketing-honesty">
              <Icon name="shieldCheck" size={15} />
              ملف واحد في كل عملية · معاينة قبل التصدير · لا تُعرض مشاريع وهمية
            </p>
          </div>

          <PipelineRibbon />
        </section>

        <section className="capability-rail" id="capabilities" aria-label="حدود وإمكانات المنتج">
          {capabilities.map((item) => (
            <article key={item.label}>
              <span>
                <Icon name={item.icon} size={18} />
              </span>
              <strong dir={item.icon === "upload" ? "ltr" : undefined}>{item.value}</strong>
              <small>{item.label}</small>
            </article>
          ))}
        </section>

        <section className="campaign-gallery" aria-labelledby="campaign-gallery-title">
          <header className="campaign-gallery__heading">
            <div>
              <span>مشاهد مختلفة، نظام طبقات واحد</span>
              <h2 id="campaign-gallery-title">من المرآب إلى المدينة، جهّز عالمك للحركة.</h2>
            </div>
            <p>
              يتعامل الاستوديو مع أنماط بصرية متنوعة مع الحفاظ على مسار واحد واضح:
              مصدر، مراجعة، ثم طبقات منظمة قابلة للتسليم.
            </p>
          </header>
          <div className="campaign-gallery__grid">
            <figure className="campaign-tile">
              <img
                src="/visuals/campaign-neon-garage.webp"
                width="1672"
                height="941"
                sizes="(max-width: 640px) calc(100vw - 24px), (max-width: 900px) calc(100vw - 40px), 62vw"
                alt="مرآب سباقات كرتوني ثلاثي الأبعاد بإضاءة سينمائية ومركبات أصلية متعددة"
                loading="lazy"
                decoding="async"
              />
              <figcaption><strong>إنتاج المركبات</strong><span>فصل العناصر والخلفية</span></figcaption>
            </figure>
            <figure className="campaign-tile">
              <img
                src="/visuals/campaign-storybook-city.webp"
                width="1672"
                height="941"
                sizes="(max-width: 640px) calc(100vw - 24px), (max-width: 900px) 50vw, 34vw"
                alt="مدينة قصصية ملونة ذات عمق بصري وطبقات معمارية متعددة"
                loading="lazy"
                decoding="async"
              />
              <figcaption><strong>عالم قصصي</strong><span>عمق جاهز للبارالاكس</span></figcaption>
            </figure>
            <figure className="campaign-tile">
              <img
                src="/visuals/campaign-coastal-kingdom.webp"
                width="1672"
                height="941"
                sizes="(max-width: 640px) calc(100vw - 24px), (max-width: 900px) 50vw, 34vw"
                alt="مملكة ساحلية قصصية عند الشروق مع منحدرات وحدائق ومناطيد أصلية"
                loading="lazy"
                decoding="async"
              />
              <figcaption><strong>بيئة سينمائية</strong><span>مقدمة ووسط وخلفية</span></figcaption>
            </figure>
          </div>
          <div
            className="campaign-props"
            role="region"
            tabIndex={0}
            aria-label="عناصر منفصلة جاهزة لبناء اللقطات؛ مرّر أفقيًا لعرض المزيد"
          >
            <figure>
              <img src="/visuals/showcase-hover-bike.png" width="1197" height="778" alt="دراجة طائرة كرتونية ثلاثية الأبعاد بخلفية شفافة" loading="lazy" decoding="async" />
              <figcaption><bdi>+vehicle</bdi><span>عنصر حركة</span></figcaption>
            </figure>
            <figure>
              <img src="/visuals/showcase-orbit-drone.png" width="1534" height="1088" alt="طائرة تصوير كرتونية صغيرة ثلاثية الأبعاد بخلفية شفافة" loading="lazy" decoding="async" />
              <figcaption><bdi>+prop</bdi><span>عنصر إنتاج</span></figcaption>
            </figure>
            <figure>
              <img src="/visuals/showcase-creative-tools.png" width="1632" height="1067" alt="مجموعة أدوات رسم وتصوير ثلاثية الأبعاد بخلفية شفافة" loading="lazy" decoding="async" />
              <figcaption><bdi>+tools</bdi><span>حزمة أدوات</span></figcaption>
            </figure>
          </div>
        </section>

        <section className="marketing-section workflows-section" id="workflows" aria-labelledby="workflows-title">
          <header className="marketing-section__heading">
            <span>مساران، نتيجة واضحة</span>
            <h2 id="workflows-title">اختر نوع المصدر، ثم احتفظ بالتحكم.</h2>
            <p>
              أدوات التجهيز تتغير حسب الملف، بينما تظل المراجعة والتسمية
              والتصدير جزءًا ثابتًا من المسار.
            </p>
          </header>

          <div className="workflow-composition">
            <article className="workflow-panel workflow-panel--image">
              <header>
                <span className="workflow-number">01</span>
                <span className="workflow-icon">
                  <Icon name="image" size={22} />
                </span>
                <div>
                  <small>تجهيز الصورة</small>
                  <h3>افصل الشخصية والعناصر بصريًا</h3>
                </div>
              </header>
              <p>
                فصل تلقائي مع أدوات توجيه ومراجعة فعلية، حتى {MAX_IMAGE_LAYERS} طبقة، وأسماء
                تبدأ بعلامة <bdi>+</bdi> لتصل إلى Adobe مرتبة.
              </p>
              <ol>
                <li><Icon name="upload" size={15} /> ارفع صورة واحدة حتى {MAX_UPLOAD_MEBIBYTES} MiB</li>
                <li><Icon name="brush" size={15} /> وجّه الفصل أو صححه يدويًا</li>
                <li><Icon name="packageCheck" size={15} /> افحص الأسماء ثم صدّر</li>
              </ol>
              <div className="workflow-cutout">
                <img
                  src="/visuals/showcase-robot.png"
                  width="1024"
                  height="1536"
                  alt="روبوت مبدع ثلاثي الأبعاد بخلفية شفافة"
                  loading="lazy"
                />
                <span aria-hidden="true">+subject</span>
                <span aria-hidden="true">+details</span>
              </div>
            </article>

            <article className="workflow-panel workflow-panel--pdf">
              <header>
                <span className="workflow-number">02</span>
                <span className="workflow-icon">
                  <Icon name="scanText" size={22} />
                </span>
                <div>
                  <small>تقسيم PDF</small>
                  <h3>حوّل النص إلى وحدات قابلة للتحريك</h3>
                </div>
              </header>
              <p>
                اختر مستوى الفصل الملائم للسرد. عدد طبقات PDF لا يخضع لسقف
                طبقات الصور، وتظل الخلفية البيضاء طبقة مقفلة.
              </p>
              <div className="pdf-mode-map" aria-label="أنماط تقسيم PDF">
                {pdfModes.map((mode, index) => (
                  <span key={mode}>
                    <b>{String(index + 1).padStart(2, "0")}</b>
                    {mode}
                  </span>
                ))}
              </div>
              <div className="pdf-lock-note">
                <Icon name="lock" size={15} />
                الخلفية البيضاء محفوظة كطبقة مقفلة
              </div>
            </article>
          </div>
        </section>

        <section className="marketing-section showcase-section" id="showcase" aria-labelledby="showcase-title">
          <header className="marketing-section__heading">
            <span>المصدر يتغير، النظام ثابت</span>
            <h2 id="showcase-title">من مشهد كامل إلى عناصر نظيفة.</h2>
          </header>

          <div className="showcase-stage">
            <section className="showcase-board showcase-board--source" aria-label="المشهد قبل فصل الطبقات">
              <header>
                <span className="showcase-kicker"><i>01</i> قبل التجهيز</span>
                <strong>مشهد حملة متكامل</strong>
              </header>
              <div className="showcase-source-grid">
                <figure className="showcase-source-card showcase-source-card--character">
                  <img
                    src="/visuals/showcase-character.webp"
                    width="1536"
                    height="1024"
                    alt="مشهد شخصية أنمي ملون قبل فصل الطبقات"
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption><b>مصدر الشخصية</b><span>مشهد كامل</span></figcaption>
                </figure>
                <figure className="showcase-source-card showcase-source-card--world">
                  <img
                    src="/visuals/showcase-world.webp"
                    width="1536"
                    height="1024"
                    alt="بيئة كرتونية غنية بالتفاصيل قبل فصل الطبقات"
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption><b>مصدر العالم</b><span>لوحة واحدة</span></figcaption>
                </figure>
              </div>
            </section>

            <div className="showcase-flow" aria-hidden="true">
              <span><Icon name="layers" size={21} /></span>
              <i />
              <b>فصل + تسمية</b>
            </div>

            <section className="showcase-board showcase-board--output" aria-label="العناصر بعد فصل الطبقات">
              <header>
                <span className="showcase-kicker"><i>02</i> بعد التجهيز</span>
                <strong>حزمة عناصر مسمّاة</strong>
              </header>
              <div className="showcase-output-grid">
                <figure className="showcase-output-card showcase-output-card--character">
                  <img
                    src="/visuals/showcase-robot.png"
                    width="1024"
                    height="1536"
                    alt="شخصية روبوت مفصولة بخلفية شفافة"
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption>+character</figcaption>
                </figure>
                <figure className="showcase-output-card showcase-output-card--car">
                  <img
                    src="/visuals/showcase-car.png"
                    width="1536"
                    height="1024"
                    alt="سيارة رياضية كرتونية مفصولة بخلفية شفافة"
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption>+car</figcaption>
                </figure>
                <figure className="showcase-output-card showcase-output-card--animal">
                  <img
                    src="/visuals/showcase-animal.png"
                    width="1254"
                    height="1254"
                    alt="حيوان كرتوني مفصول بخلفية شفافة"
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption>+animal</figcaption>
                </figure>
                <figure className="showcase-output-card showcase-output-card--background">
                  <img
                    src="/visuals/showcase-world.webp"
                    width="1536"
                    height="1024"
                    alt="خلفية العالم منفصلة عن الشخصيات"
                    loading="lazy"
                    decoding="async"
                  />
                  <figcaption>+background</figcaption>
                </figure>
              </div>
            </section>
          </div>
        </section>

        <section className="adobe-strip" aria-label="صيغ التصدير">
          <div>
            <span className="adobe-strip__icon"><Icon name="download" size={22} /></span>
            <span><small>تصدير جاهز لمسار الإنتاج</small><strong>من طبقات مراجَعة إلى ملفات قابلة للتسليم</strong></span>
          </div>
          <ul>
            <li><b>PSD</b><span>طبقات منظمة</span></li>
            <li><b>PNG</b><span>عناصر شفافة + JSON</span></li>
            <li><b>TIFF</b><span>صفحة Raster لكل طبقة صورة</span></li>
            <li><b>TXT / CSV</b><span>نص PDF منظم</span></li>
          </ul>
        </section>

        <section className="marketing-final-cta">
          <img
            src="/visuals/showcase-robot.png"
            width="1024"
            height="1536"
            alt=""
            loading="lazy"
          />
          <div>
            <span>ابدأ من الملف الحقيقي</span>
            <h2>دع كل طبقة تصل باسمها الصحيح.</h2>
            <p>جرّب الاستوديو كضيف، ثم سجّل الدخول عندما تريد حفظ مشاريعك وتتبّع التصديرات.</p>
          </div>
          <button type="button" className="marketing-primary-cta" onClick={onOpenGuest}>
            فتح الاستوديو كضيف
            <Icon name="arrow" size={18} />
          </button>
        </section>
      </main>

      <footer className="marketing-footer">
        <Brand />
        <p>استوديو عربي لتجهيز الصور وملفات PDF للتحريك.</p>
        <button type="button" onClick={onOpenAuth}>تسجيل الدخول</button>
      </footer>
    </div>
  );
}
