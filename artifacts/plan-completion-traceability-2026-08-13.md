# تقرير تتبّع إغلاق خطة الإصلاح المتسلسلة — 2026-08-13

## الحكم التنفيذي

أُغلقت محليًا متطلبات المراحل 0–5 والعناصر البرمجية المحلية من المرحلة 6، وأصبحت
بوابة الجودة الشاملة واختبارات المتصفح والتكامل الدائم المحلية ناجحة على الشجرة
الحالية. الحكم هو:

- **GO تقنيًا لتكوين مرشح إصدار محلي ومراجعته.**
- **NO-GO للنشر العام حاليًا** لأن التغيير لم يثبت في commit/tag نظيف، ولم تُبنَ
  صور موقعة من SHA الحالي، ولم تنجح بوابات managed staging وrestore/rollback/canary
  لدى مزود الإنتاج.

لا يتضمن هذا الحكم `git add` أو commit أو tag أو push أو نشرًا خارجيًا.

## هوية الشجرة محل الفحص

- الفرع: `codex/sequenced-remediation`.
- HEAD الأساسي: `8e5dc7d7a3a60e5272219a4ac98fbc8b41c0478c`.
- نسخة كل workspaces: `0.1.8`.
- الشجرة غير نظيفة وتحتوي 472 مدخلًا معدلًا أو غير متتبع؛ لذلك لا تمثل بعد مرشح
  إصدار قابلًا للتوقيع أو الرجوع الآلي.
- سقف الصيانة: إنذار غير مانع من 450، وفشل صارم فوق 550 سطرًا غير فارغ.

## تتبّع موانع P1 الأصلية

| البند | الحالة الحالية | دليل الإغلاق أو الباقي |
|---|---|---|
| P1-01 ثبات مرشح الإصدار | خارجي/غير مكتمل | النسخة 0.1.8 موحدة وأداة exact-SHA/tag/digest موجودة، لكن لا commit/tag نظيف أو صور موقعة بعد. |
| P1-02 بوابة quality | مغلق محليًا | `npm run quality` نجح نهائيًا في 305.1 ثانية بعد إصلاح 429 وحمل 30MiB؛ المعمارية والعقود والصيانة والنشر والأمن والـlint والتغطية والبناء والحزمة كلها ناجحة. |
| P1-03 استعادة source مع job/upload | مغلق محليًا | restore يقفل المشروع ويرفض job وحالات uploading/validating وupload session الحية؛ سباقات الذاكرة وPostgreSQL معرفة ومختبرة. |
| P1-04 ذرية job+fence | مغلق محليًا | enqueue وfence في transaction واحدة، claim/settlement بـCAS، وrollback عند fault/collision. |
| P1-05 حذف الحساب وlate object writes | مغلق محليًا | tombstone/drain/final inventory، object-write leases، permanent version purge، حواجز نشر، وquiet period محدود. |
| P1-06 retention reference race | مغلق محليًا | claim قبل purge ثم finalize، وحواجز مرجع DB وترتيب أقفال project→registry؛ أصلح كذلك SQL تاريخي كشفه PostgreSQL الحقيقي. |
| P1-07 MFA/recovery double consume | مغلق محليًا | استهلاك ذري، مع اختبارات TOTP وrecovery 20 دورة × 20 طلبًا في تكامل PostgreSQL. |
| P1-08 فصل الأسرار والصلاحيات | مغلق تعاقديًا، إثبات المزود باقٍ | ملفات وهوية DB/S3 مستقلة لكل workload وmigration role منفصل؛ denied-access الفعلي لدى مزود staging لم ينفذ بعد. |
| P1-09 رفع PDF 30 MiB والذاكرة | مغلق محليًا | السقف بقي 30 MiB، قارئ bounded وبوابة FIFO وتزامن قابل للضبط؛ 31 MiB يرفض بـ413 واختبار 20×30 MiB ضمن RSS المحدد. |
| P1-10 صحة worker instance | مغلق محليًا | health مربوط بالنوع وinstance ID وrelease SHA وملف الحاوية، فلا تخفي نسخة سليمة تعطل نسخة أخرى. |
| P1-11 ذرية أوامر الوثيقة | مغلق محليًا | `DocumentCommandCoordinator` واحد للتسلسل والـflush ومنع stale adoption، وأوامر الطبقات الواسعة ذرية على الخادم. |
| P1-12 ضياع مراجعة قبل source replacement | مغلق محليًا | flush/dirty guard يسبقان upload intent والاستعادة؛ guard يمنع التبديل عند فشل الحفظ. |

## تتبّع المراحل 0–6

### المرحلة 0 — البوابات والعزل

مكتملة محليًا: فُكّت دورة الاستيراد، ثُبّت عقد `group → background/text` لصفحات
PDF، أزيل dead code، عُزل E2E على المنافذ 45100/45101 دون reuse، وأصبح كتالوج
الأيقونات والـmodulepreload محميين باختبارات.

### المرحلة 1 — سلامة البيانات والذرية

مكتملة محليًا ومع دليل durable: شُغلت 43 migration على قاعدة نظيفة، ثم نجحت
مجموعة تكامل PostgreSQL 17 + MinIO versioned كاملة: 4 ملفات و33 اختبارًا. شملت
MFA المتزامن، استعادة source، job/fence، retention، حذف الحساب، S3، character،
والتصدير. حاويات التدقيق المؤقتة أزيلت بعد النجاح.

أثناء هذا التشغيل كُشف وأُصلح خطأ production فعلي في SQL الخاص بالاحتفاظ: أولوية
عامل JSON عند تكوين مفتاح export تاريخي، ومقارنات timestamp النصية، وcasts زمنية
في claim. كما حُدثت fixtures قديمة كانت تتجاوز العقود الجديدة بدل إضعاف الحماية.

### المرحلة 2 — عقد الطبقات

مكتملة محليًا: حزمة `@motionprep/layer-domain` هي المصدر الموحد للـgraph والتسمية
والـpreflight وmerge eligibility والأوامر. أوامر normalize/reorder/batch/move تحفظ
بـCAS واحد حتى 5000 طبقة. fixed وlocked محميتان في guidance والدمج والفصل والحفظ.

جولة الإغلاق الأخيرة وحدت معنى القفل في الخادم وسطح المكتب والهاتف:

- يمنع القفل تغيير الاسم، النص، الحدود، الخط، الشفافية والترتيب حتى لو أرسل عميل
  خبيث PATCH مباشرًا.
- يبقى الإظهار/الإخفاء وفتح القفل متاحين.
- لا تتحرك الطبقات الأخرى عبر موضع طبقة مقفلة، ولا تغير normalize اسمها.
- نجحت 34/34 من اختبارات layer-domain، و12/12 من اختبارات API المركزة، و22/22
  من اختبارات الواجهة المركزة.

### المرحلة 3 — صدق المعاينة والتصدير

مكتملة محليًا وبصريًا: projection واحد للرؤية والشفافية وSolo والترتيب، preflight
حقيقي، click-to-select، scroll sync، إعادة تسمية commit لا keystroke، ومزامنة
revision/segmentation. المجموعات البنيوية لا تظهر كنص داخل المعاينة ولا تدخل عدد
الطبقات الفعلية.

أضيف أيضًا تحرير حقيقي لنص طبقة PDF حتى 20,000 محرف مع validation وautosave وAPI.
كشفت الجولة أن route كان يقبل `bounds/direction/fontFamily/fontSize` لكنه يسقطها
بصمت قبل الخدمة؛ أصبح يمررها مع `fullText` واختبار HTTP يثبت الحفظ من الطرف للطرف.

أُكمل العقد بميزة المحاذاة المنطقية `start/center/end/justify`: تُحرر وتُحفظ عبر
autosave وAPI، وتنعكس في معاينة PDF وJSON/CSV وPSD، وتدخل في أهلية الدمج كي لا
تختلط طبقات ذات تنسيق متعارض. كما أصبح زر «ملاءمة» يحسب التكبير من هندسة المعاينة
الحقيقية ويستجيب لتغير الحاوية بدل تثبيت قيمة 78%.

### المرحلة 4 — الأداء وتجربة الطبقات

مكتملة محليًا وبصريًا: فهرسة O(n)، عدم تركيب أبناء الصفحات المطوية، نافذة DOM، بحث
مؤجل عابر للصفحات، فلاتر محفوظة ومتحقق منها، إجراءات هاتف، معاينة batch rename،
diagnostics وسجل أوامر. fixture مئة ألف طبقة يحافظ على الحدود الموثقة.

كشف تشغيل coverage الشامل أن تركيب 160 صفًا أوليًا كان قريبًا من مهلة الأداء؛ خُفضت
النافذة الأولى إلى 80 صفًا مع إبقاء دفعة «عرض المزيد» 160 صفًا. نجح اختبار الشجرة
تحت coverage ثلاث مرات متتالية ثم ضمن تغطية الويب الكاملة 229/229.

أضيف سجل فروق موحد لعمليات الوثيقة يعرض قبل/بعد وأسماء الإضافات والحذف والتعديل،
مع breadcrumb هرمي للطبقة النشطة ورؤوس مجلدات صفحات ثابتة. نفذت جولة متصفح حية
على سطح المكتب والهاتف؛ أصلحت 6 مخالفات Axe مؤكدة في بنية الشجرة والمعالم والحالة
الفارغة، ثم أعاد الفحص 0 مخالفات مؤكدة في حالتي PDF الفارغ والمحمل. بقي قياس تباين
المعاينة المتدرجة ضمن `incomplete` ويحتاج تحققًا يدويًا قبل ادعاء امتثال WCAG كامل.

أُغلق خطأ silent آخر في preferences: JSON صالح بنوع خاطئ أو enum قديم كان ينتج
حالة فارغة غير مرئية؛ أصبحت القيم تُفحص وتعود إلى default آمن وتُصحح في التخزين.

### المرحلة 5 — الأمن وأقل الصلاحيات

مكتملة محليًا وتعاقديًا: email verification، admin bootstrap أحادي الاستخدام،
MFA keyring/rotation، scrypt v2، redaction، CSP telemetry، license/security gates،
وفصل بيئات الأسرار والهويات. `npm audit` سبق أن أثبت صفر ثغرات معروفة، بينما
IAM/TLS/SMTP الفعلي يبقى بوابة staging لا يصح ادعاؤها محليًا.

### المرحلة 6 — المنصة والإطلاق

الجزء البرمجي المحلي مكتمل: exact release checkout، immutable digests، Cosign
verification، per-instance health، `/readyz`، capability states، alerts، runtime
image contract، topology/fault/load، وsource-map isolation.

الجزء الخارجي غير منفذ: clean commit/tag، hosted CI، بناء وفحص وتوقيع الصور، managed
staging، provider IAM/TLS/SMTP، PITR/restore، rollback وcanary على SHA/digests نفسها.

## أدلة القبول الحالية

| البوابة | النتيجة الحالية |
|---|---|
| Full quality | PASS في 305.1 ثانية على الشجرة النهائية |
| API unit/component | 115/115 ملفًا، 484/484 اختبارًا |
| Web unit/component | 64/64 ملفًا، 229/229 اختبارًا |
| Layer domain | 4/4 ملفات، 34/34 اختبارًا |
| Browser E2E | 12/12، desktop/mobile Chromium، 144.1 ثانية |
| Live layer/accessibility QA | 6 مخالفات مؤكدة قبل الإصلاح، 0 بعده في PDF الفارغ والمحمل؛ اللقطات والتقرير محفوظة |
| PostgreSQL + MinIO durable integration | 4/4 ملفات، 33/33 اختبارًا، مع 43 migration على قاعدة نظيفة |
| TypeScript / ESLint / Stylelint / dead code | PASS |
| العقود | 79 عملية API، 43 migration |
| الصيانة | 470 ملف إنتاج، 0 فوق 550، 0 exact clone blocks؛ `LayerDock` = 548 |
| بناء الإنتاج | PASS لكل packages/apps/workers؛ 19 source map خاصة و0 عامة |
| Bundle | JS 180.0 KiB، CSS 44.8 KiB gzip؛ landing 8 طلبات، hero 207 KiB، 0 fonts |
| Deployment contracts | 26/26 مع artifacts PASS |
| Production-shaped topology | PASS في 298 ثانية بصورة runtime من الشجرة الحالية: PostgreSQL/Redis/MinIO/Mailpit، نسختا API، وكل العمال؛ لا حاويات أو شبكات أو منافذ اختبار متبقية |
| Fault injection/recovery | Redis/MinIO/Mailpit/PostgreSQL: اكتشاف الانقطاع، تعافي readiness، تعافي العمال، وتعافي provider metrics كلها PASS |
| Concurrent PDF load | رحلتان متزامنتان، 2/2 ناجحتان، 0% أخطاء، workflow p95 = 1505ms، والطابور عاد إلى صفر |
| 30 MiB / 20-client capacity | PASS: ملف 31,416,448 bytes، 20/20 رحلة upload/process/review/export/download، 0% أخطاء، workflow p95 28.124s، API/worker RSS peak growth 384.75/224.46MiB، queue عادت إلى صفر |
| Rate-limit contract | PASS: التجاوزات تعود 429 و`Retry-After`، والحمل يفصل account pool عن workflow concurrency ويستخدم polling 5s |
| Diff hygiene | `git diff --check` PASS |

## ما لا يزال مطلوبًا قبل GO العام

1. مراجعة diff الكبير وتثبيته في commit أو سلسلة commits قابلة للمراجعة، ثم إعادة
   `quality` من checkout نظيف.
2. إنشاء tag `v0.1.8` بإذن المالك وتشغيل hosted CI على SHA المطابق.
3. بناء الصورتين، فحصهما وتوقيعهما، وحفظ SBOM/digests/evidence غير قابلة للتغيير.
4. نشر digests نفسها في managed staging وإثبات DB/S3/SMTP/Redis/TLS/IAM بأقل صلاحية.
5. restore drill موقع يثبت `RPO ≤ 15m` و`RTO ≤ 4h`، ثم حمل PDF ممثل حتى 30 MiB،
   fault/rollback/canary مع بوابة توقف واضحة.
6. إبقاء regional OCR وCharacter Studio والفوترة الحية خلف feature flags إلى أن
   تنجح أدلة المزود المستقلة.

## الخلاصة

لا يوجد P1 برمجي محلي معروف باقٍ من الخطة بعد الجولة الحالية. المتبقي ليس إصلاح كود
صامتًا، بل تثبيت المرشح وتشغيل سلسلة الإصدار والخدمات المدارة نفسها. أي حكم GO عام
قبل هذه الأدلة سيكون أوسع مما أثبتته الاختبارات.
