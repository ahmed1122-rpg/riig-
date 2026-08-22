# MotionPrep Studio

> **ترخيص مملوك:** إتاحة المستودع للعامة لا تجعله مفتوح المصدر ولا تمنح حق
> النسخ أو التوزيع أو الاستضافة أو إنشاء أعمال مشتقة. راجع [LICENSE](LICENSE).

## Durable local development

Use `npm run dev:durable` for QA or work that must survive API restarts. It
starts PostgreSQL, Redis, MinIO, and Mailpit through Docker Compose, applies
database migrations, then starts the web app, API, and workers. The ordinary
`npm run dev` remains the lightweight option and the UI identifies an
ephemeral runtime explicitly.

اسم المستودع على GitHub: `riig-`.

Production-readiness gates and remaining external evidence are tracked in
[docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).
The release-qualified browser matrix and its evidence boundary are documented
in [docs/BROWSER_SUPPORT.md](docs/BROWSER_SUPPORT.md).

خريطة التنفيذ الحالية والوحيدة: [docs/BUILD_MAP.md](docs/BUILD_MAP.md).

إرشادات العمل والحوكمة: [المساهمة](CONTRIBUTING.md)،
[الدعم](SUPPORT.md)، [الأمان](SECURITY.md)، و
[خط أساس إدارة المستودع](docs/REPOSITORY_ADMINISTRATION.md).

منصة عربية أولًا لتجهيز الصور والشخصيات والكتب كأصول طبقية جاهزة للتحريك.

## الحالة

هذا المستودع هو **Vertical Slice عامل وقابل للتوسع**:

- واجهة إنتاجية تفاعلية، وتستبدل بيانات العرض بوثيقة الخادم بعد رفع مصدر حقيقي.
- API typed لإنشاء المشاريع وفحص طلبات الرفع ومعالجة الصور وPDF.
- عقود مشتركة لحالات المشروع والمهام والصيغ.
- وثائق بناء وقرارات معمارية وأمنية.

قواعد الإنتاج الحالية:

- ملف واحد لكل عملية رفع: سقف 30 MiB للصور وملفات PDF.
- الصور والشخصيات والأشكال والحيوانات: 15 طبقة كحد أقصى.
- PDF: لا يوجد حد ثابت لعدد الطبقات؛ حواجز الأمان هي 30 MiB للرفع، و250
  صفحة، و100,000 عنصر نصي مستخرج.
- التصدير يسبقه وضع معاينة ومراجعة وتعديل، ولا ينشأ الملف مباشرة دون بوابة الجودة.

التقسيم الآمن للمكوّنات الشفافة يولّد أصول Raster مستقلة ومخزنة. الصور
المعتمة أو ذات الجسم المتصل تبدأ كطبقة مصدر واحدة، ثم تتيح أدوات القلم ملء
الشفافية أو الاستبعاد أو إنشاء جزء مستقل وحفظه كمراجعة فعلية. تصدير PSD
للصور وPDF يولد ملفات RGB/8-bit حقيقية. اكتملت بوابة Adobe Golden على
Photoshop 2026 (27.8.0) وAfter Effects 2026 (26.3x87)، بما يشمل ترتيب الطبقات
والأقفال والعتامة واستيراد `Composition - Retain Layer Sizes` ومقارنة
المعاينة عند الدقة الكاملة.

توجد الآن ملفات Golden حتمية وقائمة تحقق وتقرير تشغيل في
`artifacts/adobe-golden/`. يُعاد توليد النص داخل Docker بخط Noto Sans Arabic
مضمّن، وتمنع صورة الإنتاج أي اختلاف في بايتات الملفات المرجعية.

## التشغيل

المتطلبات: Node.js 24.18.1 وnpm 11.16.0. استخدم `.node-version` بوصفه المرجع الوحيد
لنسخة Node في التطوير وCI وصور الإنتاج. يفرض `devEngines` النسختين بدقة قبل
أوامر npm، وتمنع `.npmrc` التثبيت عندما لا يطابق Node عقد `engines`؛ لا تتجاوز
الفشل باستخدام `--force`.

```bash
npm install
npm run dev:stack
npm run dev
```

يشغّل `npm run dev:stack` واجهة الويب وAPI وعمال الصور والوثائق والتصدير فقط.
عامل Character اختياري ومغلق افتراضيًا؛ بعد إعداد المزود الخاص شغّله في طرفية
منفصلة عبر `npm run dev:worker-character`. لا تعتبر ميزة Character جاهزة لمجرد
تشغيل العامل: يجب أيضًا تفعيل `CHARACTER_RIG_ENABLED` واجتياز بواباتها الموثقة.
`Character Turntable` مخصص لمشاريع الصور فقط ولا يظهر لمشاريع PDF؛ يفرض API
القيد نفسه على جميع مسارات Character حتى عند استدعائها مباشرة.

تقرأ أوامر API والترحيل والعمال ملف `.env` من جذر المستودع تلقائياً.
ابدأ الاعتماديات أولاً عبر `docker compose up -d` وانتظر نجاح خدمة
`minio-init` التي تنشئ الحاوية وتفعّل versioning. لا يلزم تصدير المتغيرات
يدوياً من جلسة الطرفية.

- الواجهة: `http://localhost:5173`
- API: `http://localhost:4000`
- فحص الحياة: `http://localhost:4000/v1/health/live`
- فحص الجاهزية: `http://localhost:4000/v1/health/ready`

## أوامر الجودة

```bash
npm run lint
npm run deadcode
npm run typecheck
npm run test
npm run coverage
npm run build
```

أو شغّل البوابة الكاملة نفسها المستخدمة في CI:

```bash
npm run quality
```

تشغّل اختبارات المتصفح المسار الكامل على Chromium وFirefox وWebKit عبر سطح
المكتب وعروض الهاتف:

```bash
npm run test:e2e:install
npm run test:e2e
```

لتشغيل خط أساس OCR العربي المحلي على صورة اصطناعية ثابتة:

```bash
npm run benchmark:ocr
```

تفاصيل مصدر عينة Smoke وحدودها في
[`artifacts/benchmarks/ocr-arabic/README.md`](artifacts/benchmarks/ocr-arabic/README.md).

وللتحقق من corpus حقيقي موثق الحقوق وقياسه:

```bash
npm run verify:ocr-corpus
npm run benchmark:ocr:corpus
```

تبقى تجارب محدد OCR خارج holdout المحجوب. شغّل شبكة المرشحين الكاملة على
development أولاً، ثم أنشئ تقرير validation مستقلاً:

```bash
npm run benchmark:ocr:selector
npm run benchmark:ocr:selector:validation
```

ترفض الأداة `--split=holdout`؛ فتح جيل holdout مجمد جديد يتم فقط عبر البوابة
المحمية المخصصة لذلك.

يتضمن corpus الحالي 91 صفحة من 20 كتابًا ملكية عامة موزعة على
development/validation/holdout معزولة بحسب الكتاب. نتيجة الجيل السادس هي
CER كلية 19.39% وvalidation ‏15.13%، لكن holdout المستقل بلغ 27.02% وتجاوز
هدف الإصدار ≤25%. لذلك يبقى OCR الإقليمي معطلًا افتراضيًا ويعرض الخادم سبب
التعطيل للواجهة؛ أما استخراج النص المضمّن ورفع PDF ومراجعته وتصديره فتبقى
مسارات مستقلة ومتاحة. هذه النتيجة دليل تاريخي فقط لأن بصمة التنفيذ تغيرت،
وأي تفعيل لاحق يتطلب sealed holdout جديدًا ينجح بالبوابة الكاملة. المخطوطات
والجداول المتدهورة ليست ضمن ادعاء دعم إنتاجي موثوق حاليًا.
المنهج والنتائج وحدود الادعاء موثقة في
[`artifacts/benchmarks/ocr-arabic-corpus/report.md`](artifacts/benchmarks/ocr-arabic-corpus/report.md).

## المسار التنفيذي المتاح

بعد إنشاء مشروع وجلسة رفع، يرسل العميل ملفًا واحدًا بصيغة
PNG/JPEG/WebP/AVIF/TIFF/BMP أو PDF إلى رابط
`uploadUrl` (`PUT /v1/uploads/:uploadId/content`) باستخدام Cookie الجلسة.
الخادم لا يعتمد على امتداد
الملف: يفحص التوقيع الفعلي والحجم ويحسب SHA-256. صيغة
`png-layers-json` تنشئ ZIP قابلًا للتنزيل. للصورة تحوي المصدر وManifest،
ولـPDF تحوي المصدر وخلفية PNG بيضاء لكل صفحة ومواضع النص في Manifest.
كما تعمل مخرجات PDF النصية `txt` و`csv` و`json` وPSD فعليًا. لمشاريع
الصور يعمل `psd` ويحتفظ بالاسم والرؤية والشفافية والقفل والصورة المركبة،
ويعمل `transparent-pngs` كحزمة ZIP، و`layered-tiff` كملف TIFF متعدد
الصفحات بصفحة كاملة المساحة لكل طبقة.

واجهة الويب متصلة بهذا المسار: التسجيل وتسجيل الدخول ينشئان جلسة خادم
حقيقية، واختيار الملف ينشئ المشروع وجلسة الرفع ثم يرسل البايتات. مشاريع
الصور تتيح `PSD` و`TIFF` و`PNG شفافة` و`PNG + JSON`، ومشاريع PDF تتيح
`PSD` و`PNG + JSON` و`TXT` و`CSV` و`JSON`. تغييرات الاسم والرؤية والقفل
والشفافية و`zIndex` وترتيب
قراءة PDF تُحفظ قبل التصدير بمراجعة متفائلة للإصدار. الفصل اليدوي ينشئ أصل
Raster مستقلًا ولا يتجاوز 15 طبقة. يحدد العميل عنوان API افتراضيًا من
hostname الصفحة مع المنفذ `4000`، ويمكن تجاوزه عبر `VITE_API_ORIGIN`.

صفحتا «المشاريع» و«التصديرات» تقرآن السجلات المملوكة للمستخدم من الخادم.
تعرض المشاريع سجل إصدارات المصدر وتفتح الإصدار المحدد، وتعرض التصديرات
المحاولة ورمز الفشل والإلغاء الفعلي. تنتقل حالة المشروع إلى `uploading`
أثناء الرفع، ثم `needs_review` بعد التحقق، وإلى `completed` بعد إنشاء
الحزمة الفعلية.

التخزين الثنائي الافتراضي مؤقت داخل ذاكرة عملية API؛ يجب تفعيل
`OBJECT_STORAGE_MODE=s3` قبل الإنتاج، وتتحقق بنية الإعدادات من ذلك.

عند ضبط `OBJECT_STORAGE_MODE=s3` يستخدم API محول S3-compatible نفسه مع
MinIO المحلي أو AWS S3. في التطوير ينشئ Bucket المفقود ثم يتحقق منه، أما
في الإنتاج فيفشل بدء التشغيل إذا لم تكن الحاوية مجهزة مسبقًا، وتدخل
جاهزية التخزين ضمن `/v1/health/ready`. يستخدم MinIO المحلي
`OBJECT_STORAGE_ENCRYPTION_MODE=none` لأنه لا يملك KMS وهو مخصص للتطوير
فقط. في الإنتاج يرفض الإعداد هذا الوضع: `sse-s3` يطلب `AES256` صراحةً،
و`bucket-default` يتحقق بعد كل كتابة من أن المزود طبق التشفير ويحذف
الكائن ويرفض العملية إن لم يفعل.

على AWS يمكن ترك مفاتيح الوصول فارغة لاستخدام IAM Role أو Workload
Identity عبر سلسلة اعتماد AWS SDK الافتراضية. أما نقطة S3-compatible
مخصصة فتتطلب زوج المفاتيح، وتقبل Session Token مؤقتًا، ويجب أن تكون HTTPS
في الإنتاج. تتحقق عمليات قراءة المصدر والطبقات المشتقة وملفات التصدير من
الحجم وSHA-256 المسجلين قبل الاستهلاك أو التنزيل. الملفات تحت `sources/`
و`derived/` تظل مرتبطة بإصدارات المصدر الحية، بينما ينتهي الوصول إلى
`artifacts/` بعد 24 ساعة. النقل الحالي يمر عبر API المصادق عليه بحد 30MiB
ولا يصدر روابط S3 عامة أو موقعة. تفاصيل الصلاحيات ودورة الحياة في
[عقد التخزين السحابي](docs/OBJECT_STORAGE.md).

لتشغيل الاعتماديات الدائمة محليًا:

```bash
docker compose up -d
npm run db:migrate --workspace @motionprep/api
```

ثم انسخ `.env.example` إلى `.env` وشغّل التطبيق. لا تستخدم أسرار MinIO
المحلية الواردة في المثال خارج جهاز التطوير.

عند استخدام `PROCESSING_EXECUTION_MODE=worker` شغّل عاملي الصور والوثائق
وعامل التصدير في عمليات منفصلة. يمكن تشغيل المجموعة كلها عبر:

```bash
npm run dev:stack
```

يستحوذ العمال على المهام عبر PostgreSQL `SKIP LOCKED` مع عقد متجدد
واسترداد تلقائي وإعادة محاولة بتأخير تصاعدي. يفك عامل الصور ترميز المصدر
فعليًا باستخدام Sharp. يفصل الجزر الشفافة المتباعدة إلى PNG مستقلة بحدود
موضعية وبصمة SHA-256، ويخزن مراجعها في `LayerDocument`. إذا تجاوز
الاكتشاف 15 مكوّنًا يحفظ أكبر 14 مستقلة ويجمع الباقي في
`+تفاصيل_مجمعة` دون إسقاط بكسلات، مع إشارة مراجعة صريحة. الصورة المعتمة
تُحفظ كطبقة `+source` صادقة.
عامل الوثائق يستخرج النص المضمّن من PDF، ويحفظ الصفحة والإحداثيات وترتيب
القراءة، ويفصل حسب العنوان أو الموضوع أو الجملة أو السطر أو الكلمة أو الحرف.
كل صفحة تحصل على `+page_NNN_background` بيضاء ومقفلة. إذا كانت الصفحة
ممسوحة بلا نص مضمّن يشغّل العامل OCR عربيًا محليًا بنموذج مضمّن، ولا يرسل
الصفحة إلى خدمة شبكة. إذا تعذر التعرف يعيد `OCR_FAILED` بدل إسقاط النص
بصمت.

تعرض API مقاييس Prometheus داخل شبكة التطبيق فقط على
`/internal/metrics`؛ لا يمر هذا المسار عبر Nginx العام.

راجع [خريطة البناء الحالية](docs/BUILD_MAP.md) و[قرارات العمارة](docs/adr/0001-modular-monolith-with-workers.md).
سياسة ربط إصدار التطبيق بوسم Git وSHA وصور OCI موثقة في
[docs/VERSIONING.md](docs/VERSIONING.md).
