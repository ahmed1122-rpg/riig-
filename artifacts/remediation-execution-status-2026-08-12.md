# تقرير تنفيذ خطة الإصلاح والبناء — 12 أغسطس 2026

## الخلاصة التنفيذية

تم تنفيذ المراحل المحلية للخطة بالتتابع مع الحفاظ على واجهات HTTP وأسماء
الحزم والعاملين والمهاجرات. المرشح الحالي يمر من بوابة الجودة الكاملة داخل
صورة QA نظيفة ومثبتة، لكنه لم يُنشر ولم يحصل بعد على أدلة البيئات الخارجية.

قرار النطاق النهائي واضح: خاصية Turntable/Character Rig تتعامل مع **مشاريع
الصور فقط**. لا تظهر في مساحة عمل الكتاب أو PDF، وتعلن capability أنها تدعم
`image` فقط، وترفض جميع عمليات Character التسع مشروع الكتاب برد مغلق
`404/PROJECT_NOT_FOUND`.

الحالة الحالية: **جاهز محليًا للمراجعة وHosted CI، وغير مصرح للإنتاج حتى
اكتمال البوابات الخارجية**.

## ما تم إصلاحه

### 1. العقود والمسارات والإصدار

- إضافة خط أساس آلي يغطي 71 عملية API، و39 migration، وpackage exports، وnpm
  scripts، وworker entrypoints، وDocker targets، وCompose services، وfeature
  flags، والمدخلات الديناميكية التي لا يراها Knip تلقائيًا.
- توحيد إصدار التطبيق والحزم عند `0.1.7`، وربط OpenAPI وhealth/build identity
  بالمصدر نفسه.
- استكمال OpenAPI لكل عمليات Character التسع، بما في ذلك bodies وsuccess
  responses وpath parameters وsecurity والتصنيف.
- فصل إعداد Swagger إلى وحدة مستقلة، وفصل مخططات Character OpenAPI، من دون
  تغيير أي route أو payload عام.

### 2. سلامة Character Rig والتزامن

- إصلاح تخصيص الإصدارات المتزامن، وتعارضات idempotency، وإعادة استخدام نموذج
  الهوية بناءً على fingerprint حتمي.
- توحيد canonical JSON ومنع اختلاف hash بسبب ترتيب مفاتيح الكائن.
- إضافة commit ذري محمي بالـlease لنتائج التدريب والتوليد وتجميع PSD، بحيث لا
  يستطيع عامل فقد lease نشر نتيجة قديمة.
- فصل `CharacterJobResultCommitter` وإضافة تنفيذ PostgreSQL ذري يربط تحديث
  aggregate بحالة job والـlease داخل transaction واحدة.
- تقوية استرجاع jobs المنتهية lease، ونتائج التعارض، ومراجعة generation
  المتزامنة، وتخصيص versions داخل PostgreSQL.
- التحقق من SHA-256 عند تنزيل artifact، وليس الحجم وحده، ومنع same-size tamper.
- إضافة اختبارات compiler للعلاقة بين الأجزاء والـSHA وأبعاد canvas وترتيب
  المخرجات.

### 3. حصر Turntable في الصور

- العقد العام يعلن `supportedProjectKinds: ["image"]`.
- API capability والـfallback في الويب يحملان القيد نفسه.
- سجل الأدوات يعرّف Character كأداة `mode: "image"`، مع اختبار يمنع ظهورها
  في الكتاب/PDF.
- controller و`WorkspaceDialogs` يتحققان صراحة من وضع الصورة ووجود أبعاد
  canvas قبل فتح Character Studio.
- طبقة API تتحقق من `project.kind === "image"` قبل كل عملية Character؛ اختبار
  شامل يمر على العمليات التسع ضد مشروع كتاب.
- بقي العامل خلف `CHARACTER_RIG_ENABLED=false` افتراضيًا، مع kill switch مباشر.

### 4. الواجهة وقابلية الصيانة

- استخراج `useCharacterStudioController` وتقليل
  `CharacterStudioDialog.tsx` إلى مكوّن عرض صغير نسبيًا، مع اختبارات الرحلة
  والفشل وإعادة المحاولة.
- توحيد سلوك modal/focus/inert/aria-hidden في primitive مشترك، واستخدامه في
  Dialog وdrawer ومراجعة التصدير.
- تقسيم `app.ts` وإعداد OpenAPI بعد أن تجاوزا حد 500 سطر؛ الحاجز النهائي يسجل
  صفر ملفات ضخمة غير مستثناة.
- بوابة الصيانة تفحص 397 ملف إنتاج وتسجل صفر exact clone blocks؛ لم تتم إضافة
  دين تقني إلى baseline لتجاوز الفحص.

### 5. إزالة التكرار الآمن فقط

- إضافة `KeyedOperationLock` مشترك مع إبقاء الأسماء القديمة كـadapters للحفاظ
  على الاستيرادات الحالية.
- توحيد قفل مشروع upload في PostgreSQL بين finalization وcancellation وintegrity
  failure.
- توحيد reading-order بين regional OCR وعمليات نص PDF مع اختبارات domain.
- توحيد listener أخطاء قاعدة البيانات و`toIso` وcanonical JSON حيث كان الدمج
  لا يغيّر semantics.
- لم يتم دمج SQL summaries أو dispatchers أو repositories المتشابهة شكليًا
  عندما كان اختلاف الملكية أو المعاملة مهمًا.

### 6. Node وبيئة QA

- Windows الحالي: Node `24.18.1` وnpm `11.16.0`; تم التخلص من Node 26.
- `.node-version` و`engines` و`devEngines` و`packageManager` وكل الحزم وصور
  Docker متوافقة مع السياسة نفسها، مع `engine-strict=true`.
- صورة `Dockerfile.qa` متعددة المراحل ومثبتة بالـdigest؛ تحتوي Git وFontconfig
  وأدوات التطوير، ولا تُستخدم كصورة runtime.
- إصلاح نقل `node_modules` المتداخلة لكل workspace؛ كان
  `@vitejs/plugin-react` موجودًا تحت `apps/web/node_modules` ولا يصل إلى مرحلة
  QA النهائية.
- تضمين أدلة Adobe المطلوبة فقط في build context، مع عقد يمنع فقدها.
- توحيد خيارات pdfjs ومسار standard fonts المضمّن، ومنع اعتماد العرض على خطوط
  المضيف.
- إضافة `run-quality-qa.mjs` لحفظ تقرير JSON سواء نجحت البوابة أو فشلت، وربطه
  بـCI artifact.

### 7. أخطاء في البوابات اكتُشفت أثناء التنفيذ

- كانت صورة QA تفتقد أدلة Photoshop/After Effects بسبب `.dockerignore`؛ تم
  إصلاح الاستثناءات وتثبيتها باختبار عقد.
- كان سكربت race يذكر ملف PostgreSQL integration، لكن Vitest الافتراضي يستبعد
  `*.integration.test.ts` بصمت؛ تم فصل الأمر إلى تشغيل وحدوي ثم تشغيل صريح عبر
  `vitest.integration.config.ts`، وإضافة اختبار يمنع تكرار هذا الخطأ.
- كانت روابط workspaces المحلية داخل `node_modules` آتية من سياق Docker وغير
  صالحة على Windows؛ أعاد `npm ci` إنشاءها محليًا من lockfile.
- تنظيف import غير مستخدم كشفه ESLint، وتعريف `tsx` كاعتماد جذري لأنه مستخدم
  مباشرة في root scripts، وتوثيق مداخل QA/Adobe الديناميكية في Knip baseline.
- حُذفت حاوية BuildKit المؤقتة اليتيمة التي أنشأتها محاولة البناء، ولم تُمس أي
  حاوية تطبيق أو خدمة أخرى.

## دليل التحقق النهائي

- `artifacts/qa/quality-summary.json`: النتيجة `passed`، رمز الخروج 0، Node
  `v24.18.1`، التطبيق `0.1.7`، والمدة 226,630 ms.
- `npm ci` داخل QA: 554 حزمة، صفر vulnerabilities معروفة في تدقيق npm.
- العقود: 71 عملية API و39 migration دون drift.
- الصيانة: 397 ملفًا، صفر oversized files، صفر exact clone blocks.
- نجحت ESLint وStylelint وKnip وTypeScript لكل workspaces وحدود coverage والبناء
  لكل 12 workspace.
- Character/PostgreSQL: ثلاث جولات مستقلة؛ كل جولة 13 اختبار race وحدويًا و4
  اختبارات PostgreSQL حقيقية بعد migrations 001–039.
- Web bundle: JavaScript ‏165.2 KiB وCSS ‏43.2 KiB بعد gzip، داخل الميزانية.
- Adobe Golden وCharacter benchmark وfixture/OCR verification نجحت. Regional
  OCR يبقى مغلقًا لأن holdout المستقل قديم ولا يحقق بوابة التفعيل.

## الملفات أو الدوال غير المستخدمة والمسارات المكسورة بعد الإصلاح

- Knip وTypeScript وESLint لا تعرض مرشح حذف غير مستخدم حاليًا.
- الاستثناءات الديناميكية الوحيدة موثقة ومثبتة في contract baseline: أدوات
  Adobe وسكربت تشغيل QA، لأنها تُستدعى من Docker/CI لا من import ثابت.
- لا يوجد مسار HTTP ثابت مكسور وفق snapshot الحالي، ولا package export أو worker
  entrypoint مفقود وفق بوابة العقود.
- لا توجد كتلة تكرار حرفية فوق حد الصيانة. التشابه المتبقي غير مدمج عمدًا عندما
  تختلف transaction أو ownership أو failure semantics.
- لا يُنصح بحذف ملفات أو دوال إضافية قبل ظهور دليل جديد من gates؛ الحذف الآن
  سيزيد خطر كسر المدخلات الديناميكية أكثر مما يضيف قيمة.

## ما تبقى عند توفر البوابات الخارجية

1. دمج المرشح وتثبيت SHA كامل وتشغيل Hosted CI المحمي.
2. نشر صور runtime/web موقعة ومثبتة بالـdigest مع SBOM/provenance.
3. نشر staging بنفس الـdigests مع Character وregional OCR وlive billing مغلقة.
4. إثبات اتصال PostgreSQL/Redis/S3/SMTP المُدارة ثم durable integration.
5. backup/restore منسق، وقياس RPO/RTO، ثم fault/load/memory/rollback drills.
6. ربط مزود Character inference خاص عبر HTTPS واختبار egress/timeout/retry/SHA
   والتنظيف والـleases على صور غير إنتاجية.
7. Character Animator Golden وموافقة المنتج/القانون، ثم canary داخلي للصور فقط.
8. التوسع التدريجي مع dashboards/alerts، والرجوع الفوري عبر feature flag وإيقاف
   العامل عند أي P1.

قائمة المدخلات والترتيب التنفيذي الكامل موجودة في
`docs/EXTERNAL_GATE_INPUTS.md`. إلى أن تُستكمل الأدلة الخارجية، القرار الصحيح
هو **Production No-Go** مع جاهزية محلية للمراجعة وCI.
