# تقرير التدقيق الشامل للشفرة وخطة الإصلاح المتتابعة

**تاريخ التدقيق:** 2026-08-12  
**المستودع:** `riig-`  
**الفرع:** `main`  
**نقطة الأساس:** `c168e5c` — `v0.1.7-4-gc168e5c`  
**طبيعة هذا المستند:** تقرير تشخيصي وخطة تنفيذ؛ لم تُجرَ بسببه أي تعديلات وظيفية أو حذف أو إعادة تسمية للمسارات.

## 1. الملخص التنفيذي

المستودع في حالة بناء محلي جيدة: تمر بوابات lint وTypeScript وKnip والبناء والتغطية والحزمة، ولا توجد حالياً استيرادات نسبية مكسورة أو مداخل scripts مفقودة أو روابط ملفات داخلية مفقودة ضمن النطاق المفحوص. كذلك لم يُثبت وجود ملفات أو exports أو dependencies أو متغيرات أو معاملات غير مستخدمة وفق Knip وTypeScript وESLint.

مع ذلك، لا يُنصح بتفعيل **Character Rig** في بيئة خارجية بعد. الميزة مغلقة افتراضياً، وهذا يمنع العيوب المكتشفة فيها من تعطيل المسار الأساسي الحالي، لكن قبل تشغيلها توجد ست بوابات عالية الأولوية تتعلق بإعادة استخدام إعداد تدريب قديم، وحماية الكتابة بعد فقدان lease، وسباقات التزامن في PostgreSQL، والتحقق من سلامة artifact عند التنزيل، وغياب اختبار تكامل فعلي لمسار التخزين الإنتاجي، وتقادم دليل الجاهزية عن نقطة الأساس الحالية.

| القرار | الحالة | السبب |
|---|---|---|
| بناء الشفرة الحالية | **يمر** | lint وtypecheck وbuild وbundle وcoverage تمر |
| المسارات الثابتة | **سليمة ضمن النطاق المفحوص** | 1,339 استيراداً نسبياً و75 رابط ملف و76 مدخل script بلا مسار مفقود |
| الكود غير المستخدم | **لا توجد نتيجة مؤكدة** | Knip وTS وESLint تمر بلا مخالفات |
| نشر المسار الأساسي إلى staging | **مشروط بالبوابات الخارجية** | PostgreSQL/Redis/S3/SMTP والاستعادة والحمل والقانوني لم تُثبت هنا |
| تفعيل Character Rig خارجياً | **No-Go حالياً** | عيوب P1 وفجوات تكامل PostgreSQL والـ lease |
| الحذف أو إعادة التسمية أثناء الإصلاح | **غير مسموح افتراضياً** | يلزم الحفاظ على العقود والمسارات وواجهات الأدوات مع طبقات توافق |

### توزيع النتائج

- **P0 — عطل حالي يمنع البناء أو يفقد بيانات في المسار المفعّل:** لا توجد نتيجة مؤكدة.
- **P1 — يجب إصلاحه قبل تفعيل Character Rig أو اعتماد الإصدار الحالي للنشر:** 6 مجموعات نتائج.
- **P2 — يجب إدخاله في دورة التقوية التالية:** العقود، تغطية الواجهة، تعقيد الدوال، وإعادة تشغيل الـ review والمترجم.
- **P3 — دين تقني وتحسين موثوقية الأدوات:** التكرارات الصغيرة، صورة التدقيق، وتحذيرات خطوط PDF.

## 2. الافتراضات وحدود التدقيق

1. نقطة الأساس هي نسخة العمل النظيفة على `c168e5c`، وليس تقارير الإصدارات التاريخية فقط.
2. `CHARACTER_RIG_ENABLED=false` هو الوضع الافتراضي، والعامل الجديد اختياري ويتطلب مزود inference خاصاً.
3. التدقيق غطى الملفات المتتبعة، ومصادر `apps/` و`packages/` و`scripts/`، والاختبارات، وملفات workflow وDocker والتوثيق والـ manifests.
4. فحص المسارات يثبت المسارات **الثابتة القابلة للاستخراج**. لا يمكنه وحده إثبات صلاحية URL خارجي، أو secret، أو bucket/object يُبنى وقت التشغيل، أو endpoint لدى مزود خارجي.
5. المرور المحلي لا يساوي دليلاً على production؛ الاختبارات الخارجية والاستعادة والحمل والتكامل المدفوع تبقى بوابات مستقلة.
6. نسبة تغطية 0% لا تعني أن الملف غير مستخدم؛ قد يكون entrypoint أو مكوّناً يُحمّل ديناميكياً. الحذف لا يعتمد على التغطية وحدها.

## 3. نطاق المستودع الذي تم فحصه

| البند | العدد/النتيجة |
|---|---:|
| الملفات المتتبعة | 1,118 |
| ملفات TypeScript | 397 `.ts` + 69 `.tsx` |
| scripts بصيغة `.mjs` | 85 |
| ملفات Markdown | 80 |
| ملفات SQL | 39 |
| package manifests / workspaces | 13 |
| ملفات الإنتاج المفحوصة في `apps/packages/scripts` بعد استبعاد الاختبارات | 384 |
| الدوال/الأساليب/الـ callbacks المستخرجة بنيوياً | 3,194 |
| ملفات source/test المفحوصة لمسارات الاستيراد | 550 |
| الاستيرادات النسبية المفحوصة | 1,339 |
| ملفات Markdown/HTML المفحوصة | 83 |
| روابط الملفات النسبية المفحوصة | 75 |
| مراجع `npm run` المفحوصة في docs/workflows/Docker | 136 |
| مداخل `node`/`tsx` في manifests | 76 |

## 4. أدلة الصحة الحالية والإصلاحات المثبتة

### 4.1 ما يمر الآن

- `lint` و`stylelint`: ناجحان.
- `typecheck` لجميع workspaces: ناجح.
- `knip`/فحص dead code: ناجح بلا نتائج.
- `build` لجميع workspaces: ناجح.
- بناء حزمة الويب: ناجح؛ 1,678 module، JavaScript نحو 164.5 KiB gzip وCSS نحو 43.2 KiB.
- `npm audit --audit-level=high`: صفر ثغرات معروفة في snapshot الحالي.
- architecture وmaintainability وdeployment وrecovery وincident وrelease utilities وfixture/visual verification: ناجحة.
- فحوص GitHub الرئيسية الدقيقة عند SHA الحالي: 9 من 9 ناجحة، وتشمل CodeQL وsecret scan وbrowser E2E وcontainer build وdurable integration وproduction topology وrelease fixtures وJS/TS.
- سياسة Node موحدة حالياً على Node `24.18.1` وnpm `11.16.0` في `package.json` وأدوات البناء.
- Character Rig مدمج ببوابة إغلاق افتراضية، وعامل مستقل، وmigrations `038` و`039`، وفحوص benchmark وPSD؛ وهذا تصميم عزل صحيح، لكنه ليس إذناً بالتفعيل قبل إغلاق نتائج P1.

### 4.2 ملاحظة مهمة عن `npm run quality`

تشغيل الأمر كاملاً داخل صورة audit النحيفة وصل إلى `verify:clean` ثم توقف برسالة `spawn git ENOENT` لأن الصورة لا تحتوي Git. اختبار `scripts/clean.test.mjs` نفسه مرّ على المضيف حيث Git متاح، كما شُغلت بقية بوابات الجودة منفصلة ومرت.

التصنيف الصحيح: **فجوة في بيئة التدقيق/متطلب مسبق، وليست خطأ في الشفرة أو سبباً لإضافة Git إلى صورة runtime**. الحل هو صورة CI/QA مخصصة تحتوي الأدوات أو preflight واضح، مع إبقاء صورة التشغيل صغيرة.

## 5. المسارات المكسورة والعقود

### 5.1 النتائج المؤكدة

لم يُعثر على مسار ثابت مكسور في الفئات الآتية:

- 1,339 مرجع استيراد نسبي من 550 ملف source/test: **0 unresolved**.
- 75 رابط ملف نسبي من Markdown/HTML: **0 missing**.
- 136 مرجعاً لأوامر `npm run` في docs/workflows/Docker: **0 script missing**.
- 76 مدخل تشغيل `node`/`tsx` من 13 manifest: **0 entry missing**.
- الأصول العامة المستخدمة في `/visuals` و`/legal` وfavicons: موجودة، و`verify:visuals` مرّ على 14 أصلاً.
- مقارنة المسارات الثابتة بين API والويب لم تثبت endpoint مفقوداً. المرشح الوحيد كان نتيجة إيجابية كاذبة سببها بناء query ديناميكياً في `apps/web/src/features/workspace/layer-document-client.ts:171`، والمسار المقابل موجود في الخادم.
- مراجع build context وDocker وworkflows الحالية مرّت عبر اختبارات container-build وproduction-topology.

### 5.2 ما لا يثبته الفحص الثابت

ينبغي إبقاء فحوص runtime للآتي:

- `CHARACTER_INFERENCE_BASE_URL` وStripe وSMTP وS3/MinIO وRedis وPostgreSQL.
- مفاتيح object storage المبنية من project/job IDs.
- redirects وCORS وTLS وDNS في البيئة الخارجية.
- الروابط القانونية النهائية وموافقات سياسة الخصوصية والشروط.
- compatibility الفعلية لمزود Character inference وإصداره.

### 5.3 سياسة الحفاظ على المسارات أثناء الإصلاح

1. لا تغيير لأي `/v1/...` أو package export أو script name ضمن إصلاح داخلي.
2. عند ضرورة إعادة التسمية، يبقى الاسم القديم re-export أو wrapper موثقاً لدورة إصدار واحدة على الأقل.
3. إضافة snapshot آلي لمسارات API وOpenAPI وpackage exports وأوامر npm قبل أول refactor.
4. migrations تظل forward-only؛ لا تعديل لملف migration نُشر، بل migration تالية قابلة للعودة تشغيلياً.
5. جميع تغييرات Character تبقى خلف feature flag حتى نجاح canary والاستعادة.

## 6. النتائج عالية الأولوية P1

### P1-1 — إعادة استخدام model قديم عند تغيير إعداد التدريب

**الموقع:** `apps/api/src/character-rig/character-identity-bootstrap-service.ts:59-102`

`requestHash` يتضمن `trainingConfiguration`، لكن شرط إعادة استخدام آخر model في الأسطر 71-76 يقارن dataset/provider/base model/status فقط. لذلك تغيير إعداد التدريب يُنتج operation/request جديداً، ثم يُعاد استخدام model version يحمل إعداد التدريب السابق.

**الأثر:** تدريب بمدخلات غير التي وافق عليها الطلب، ونتيجة غير قابلة للتتبع الصحيح، مع التباس idempotency.

**الإصلاح:** مقارنة configuration تمثيلاً canonical عميقاً ضمن شرط reuse، أو حفظ `trainingConfigurationFingerprint` صريحاً. إذا تغيرت الإعدادات يجب إنشاء model version جديد.

**مشكلة مرتبطة:** `canonicalJson` في الملف نفسه (`:121-124`) و`stableJson` في `character-generation-service.ts:246-253` يستخدمان `localeCompare`. ترتيب locale قد يختلف بين البيئات، فلا يصلح لمدخل hash حرج. توجد آلية أقوى في `apps/api/src/idempotency/request-fingerprint.ts`. يجب توحيد canonical JSON باستخدام ترتيب Unicode code-unit مستقل عن locale واختبارات golden للنصوص المتداخلة وUnicode وترتيب المفاتيح.

**اختبار القبول:** نفس الإعداد بترتيب مفاتيح مختلف يعيد نفس العملية؛ تغيير قيمة واحدة ينشئ model version جديداً؛ نفس fixture يعطي hash نفسه على Windows/Linux وصورة CI.

### P1-2 — الكتابة بعد فقدان lease ليست fenced

**المواقع:**

- `apps/api/src/character-rig/character-job-executor.ts:30-64`
- `apps/api/src/character-rig/character-job-executor.ts:130-228`
- `apps/api/src/character-rig/character-job-executor.ts:231-348`
- `apps/api/src/infrastructure/postgres/postgres-character-rig-repository.ts`

العامل يتحقق من `heartbeat.leaseLost()` بعد اكتمال التدريب/التوليد/التجميع، لكن تلك الدوال تكتب model/generation/rig وartifacts قبل هذا الفحص. عمليات الحفظ لا تشترط أن `character_jobs.lease_owner` ما زال العامل نفسه وأن lease لم تنتهِ.

**الأثر:** عامل بطيء يفقد lease، يستلم عامل آخر المهمة، ثم يستطيع العامل الأول كتابة نتيجة قديمة أو استبدال artifacts قبل أن يكتشف فقدان lease.

**الإصلاح:** commit ذري fenced داخل transaction يربط تحديث النتيجة وإكمال job بمالك lease أو fencing token متزايد. لا يكفي فحص heartbeat في الذاكرة. يجب حذف artifact المؤقت إذا رفض الـ commit بسبب lease lost.

**اختبار القبول:** اختبار عاملين حقيقيين على PostgreSQL: يفقد الأول lease أثناء provider call، يستلم الثاني، وتُقبل نتيجة الثاني فقط؛ تُرفض كتابة الأول وتُحذف artifacts التابعة له ولا يظل job عالقاً.

### P1-3 — سباقات idempotency وترقيم الإصدارات وعدم تطابق سلوك الذاكرة مع PostgreSQL

**المواقع:**

- `apps/api/src/infrastructure/postgres/postgres-character-rig-repository.ts:40-82`
- `apps/api/src/infrastructure/postgres/postgres-character-rig-repository.ts:145-173`
- `apps/api/src/infrastructure/postgres/postgres-character-rig-repository.ts:186-227`
- `apps/api/src/infrastructure/postgres/postgres-character-rig-repository.ts:348-376`
- `apps/api/src/infrastructure/postgres/postgres-character-job-repository.ts:34-74`
- `apps/api/migrations/038_character_rig_context.sql`

الـ schema يفرض uniqueness على `(project_id, version)` أو `(bible_id, version)` وعلى `(project_id, idempotency_key)` و`(project_id, operation_key)`. الخدمات تعمل غالباً بطريقة read-then-insert، بينما `ON CONFLICT` يعالج `id` فقط. طلبان متزامنان قد يريان نفس الحالة ثم يصطدم أحدهما بقيود مختلفة، فيتحول conflict متوقع إلى خطأ قاعدة بيانات/HTTP 500.

كذلك `saveIdentityModelVersion` و`saveGenerationAttempt` و`saveRigVersion` تعيد `void`. إذا حدث conflict على `id` وفشل شرط `WHERE` فقد يكون التحديث no-op من دون أن تعرف الخدمة، ثم تواصل وكأن الحفظ تم.

**الأثر:** 500 بدلاً من replay/409، ترقيم versions غير ثابت، واحتمال enqueue أو processing لكيان لم يُحفظ كما تتوقع الخدمة.

**الإصلاح:** transactions أو advisory/row locks داخل bounded context، ونتائج صريحة مثل `created | updated | replayed | conflict | lease-lost`. يجب أن تكون uniqueness constraints نفسها هدف `ON CONFLICT`، مع إعادة قراءة آمنة ومقارنة request hash.

**اختبار القبول:** اختبارات تزامن مباشرة لكل من bible initial save، identity version، generation idempotency، job operation key، وrig version؛ النتيجة واحدة فقط ولا يظهر 500 ولا version gap غير مقصود.

### P1-4 — تنزيل Character artifact لا يطابق SHA المحفوظ في المحاولة

**الموقع:** `apps/api/src/character-rig/character-rig-routes.ts:278-311`

المسار يقارن content type والحجم فقط مع `attempt.outputArtifact`، ولا يقارن `sha256`. قد يتحقق object storage من metadata الحالية، لكن هذا لا يثبت أنها ما زالت تطابق المرجع غير القابل للتغيير المخزن في generation attempt إذا استُبدل object وmetadata معاً ببيانات أخرى بالحجم والنوع نفسيهما.

**الأثر:** تقديم bytes مختلفة عن artifact التي تمت مراجعتها وربطها بالمحاولة.

**الإصلاح:** فحص metadata/SHA مقابل `attempt.outputArtifact.sha256` قبل الإرسال، أو stream verified يحسب hash مع حد الحجم. لا يُرسل الجسم عند mismatch.

**اختبار القبول:** استبدال object ببيانات مختلفة لها الحجم والنوع نفسيهما يعيد `CHARACTER_ARTIFACT_INTEGRITY_FAILED` ولا يسرّب body.

### P1-5 — مسار PostgreSQL الإنتاجي لـ Character بلا دليل تكامل مباشر كافٍ

اختبارات Character الحالية تغطي الخدمات غالباً بمستودعات in-memory. اختبار migration integrity يتحقق من نص DDL، لكنه لا يثبت سلوك `PostgresCharacterRigRepository` و`PostgresCharacterJobRepository` مع القيود والمعاملات والتزامن. لم يظهر سيناريو Character end-to-end مباشر في حزمة PostgreSQL/S3 التكاملية الحالية.

**الأثر:** الفروق المذكورة في P1-2 وP1-3 لا تلتقطها الاختبارات الناجحة الحالية، ما يجعل المرور الأخضر مطمئناً أكثر مما ينبغي لهذا المسار.

**الإصلاح:** حزمة تكامل للمهاجرتين 038-039 تشمل CRUD/revision/idempotency/concurrency/lease recovery/review transaction/retention/account deletion وS3 tamper.

**اختبار القبول:** تشغيل الحزمة على PostgreSQL وobject storage حقيقيين في CI، لا doubles، وتصبح إلزامية في workflow تفعيل Character.

### P1-6 — دليل الإصدار والجاهزية لا يغطي نقطة الأساس الحالية

- آخر tag هو `v0.1.7`، بينما `main` الحالي بعده بأربع commits: `v0.1.7-4-gc168e5c`.
- جميع package manifests و`apps/api/src/app.ts:62` وdefault في `scripts/verify-staging-application.mjs:10` ما زالت تعلن `0.1.3`.
- `docs/PRODUCTION_READINESS.md:3` حالته حتى 2026-08-10، ويصف migrations حتى 001-037 في موضعه، بينما الحالية تشمل 038-039 وعامل Character الرابع.

**الأثر:** التباس هوية binary/image والتتبع التشغيلي، وخطر استخدام evidence تاريخي لتفويض شفرة أحدث لم تختبر في البيئة نفسها.

**الإصلاح:** تعريف سياسة واضحة تفصل product/package version عن release tag وcommit SHA، ومصدر واحد لـ application version، وتوليد build metadata. تحديث evidence للإصدار المرشح الحالي فقط بعد مرور البوابات الخارجية.

**اختبار القبول:** `/health` أو endpoint التشغيلي والصورة وSBOM وrelease evidence تعرض tag وcommit SHA المتطابقين؛ staging verifier لا يعتمد default تاريخياً صامتاً.

## 7. نتائج الأولوية P2

### P2-1 — مطابقة rig تفقد علاقة الجزء بالـ artifact ولا تثبت أبعاد التجميع

**الموقع:** `apps/api/src/character-rig/character-rig-compiler-service.ts:53-105`

إنشاء `sourceFingerprint` في البداية keyed وصحيح الاتجاه، لكن قرار `matching` في الأسطر 72-81 يقارن قائمتين مرتبتين من SHA فقط. بذلك يمكن اعتبار نفس multiset مطابقاً حتى لو تبدلت علاقة `view:part -> SHA`. كما أن `CharacterRigVersion` لا يخزن canvas dimensions؛ إعادة استخدام rig مع طلب أبعاد جديد قد تعيد تجميع نفس version/ID بمعنى إخراج مختلف.

**الإصلاح:** حفظ fingerprint keyed يشمل part key وSHA وأبعاد المصدر وأبعاد canvas/schema version، ومقارنته مباشرة. artifact ناتج مختلف يجب أن ينتج rig version جديداً أو compilation revision صريحاً.

### P2-2 — replay لمراجعة generation قد يعيد attempt قديماً

**الموقع:** `apps/api/src/character-rig/character-generation-service.ts:120-206`

عند العثور على review موجود، تعيد الدالة `attempt` الذي قُرئ قبل list reviews. إذا حدث commit متزامن بين القراءتين، يمكن أن يعود replay بحالة pre-review. فرع السباق بعد فشل commit يعيد القراءة، لكن فرع existing المبكر لا يفعل.

**الإصلاح:** إعادة تحميل attempt بعد إثبات review الموجود أو جعل قراءة review+attempt snapshot/transaction واحدة.

### P2-3 — عقد OpenAPI لمسارات Character غير مكتمل

المسارات مولدة وموجودة، لكن عمليات الكتابة تظهر summaries عامة ولا تعرض request bodies وsuccess schemas typed بشكل كافٍ؛ الاختبار الحالي يثبت عدداً إجمالياً من العمليات ولا يثبت مسارات Character واحداً واحداً.

**الإصلاح:** schemas صريحة للطلبات و2xx/errors لكل عمليات Character التسع، واختبار snapshot/contract يثبت path وmethod وsecurity وrequest/response.

### P2-4 — غموض تركيب URL لمزود inference

**الموقع:** `apps/api/src/character-rig/http-character-inference-provider.ts:48-57,122`

`new URL(path, baseUrl)` له دلالات مختلفة إذا كان base URL بلا `/` أخيرة أو يحتوي path prefix. الـ schema يثبت URL صالحاً لكنه لا يحدد هذه السياسة.

**الإصلاح:** تطبيع URL وفرض slash أخيرة، أو دعم prefix بعقد واضح واختبارات `https://host/api` و`https://host/api/`.

### P2-5 — تغطية الويب ضعيفة في ملفات عالية المخاطر

إجمالي web coverage يمر بالحدود الحالية لكنه منخفض:

| المقياس | النسبة الحالية | threshold الحالي |
|---|---:|---:|
| Statements | 34.20% | 26% |
| Branches | 33.79% | 28% |
| Functions | 26.42% | 19% |
| Lines | 35.13% | 26% |

ملفات حرجة:

| الملف | Statements | Branches | Functions | Lines |
|---|---:|---:|---:|---:|
| `CharacterStudioDialog.tsx` | 0% | 0% | 0% | 0% |
| `Workspace.tsx` | 0% | 0% | 0% | 0% |
| `WorkspaceEditorLayout.tsx` | 0% | 0% | 0% | 0% |
| `AuthGateway.tsx` | 24.54% | 17.09% | 16.66% | 25.25% |
| `LayerDock.tsx` | 22.17% | 16.86% | 17.28% | 24.15% |
| `ExportReview.tsx` | 38.06% | 50.23% | 21.05% | 43.33% |

**الإصلاح:** إضافة journeys feature-enabled لـ Character وموازين accessibility/focus/retry/review، ثم رفع thresholds تدريجياً فقط بعد اختبارات ذات قيمة. لا تُكتب اختبارات لزيادة الرقم دون إثبات سلوك.

### P2-6 — تعقيد دوال كبيرة قريب من حد حجم الملف

بوابة maintainability الحالية وجدت 0 ملف يتجاوز 500 سطر غير فارغ و0 clone إنتاجي بطول 16 سطراً أو أكثر. لكن عدداً من الملفات يقترب من الحد:

- `auth-service.ts`: 499 سطراً.
- `app.ts`: 498.
- `ExportReview.tsx`: 494.
- `verify-deployment.mjs`: 493.
- `processing-service.ts`: 492.
- `processing-job-executor.ts`: 488.
- `CharacterStudioDialog.tsx`: 483.
- `processing-routes.ts`: 481.
- `upload-service.ts`: 476.
- `WorkspaceChrome.tsx`: 474.

التحليل البنيوي التقريبي، وليس مقياس cyclomatic رسمي، وجد branch points مرتفعة في `ExportReview` و`CharacterStudioDialog` و`LayerDock` و`BillingPortal` و`AdminPanel` و`AuthGateway` و`buildApp` و`processClaimedJob`.

**الإصلاح:** حدود على مستوى الدالة/المكوّن، وتقسيم حسب use-case مع إبقاء facade/export الحالي. لا تقسيم شكلي إلى ملفات تمرر الاستدعاءات فقط.

## 8. الدوال والملفات غير المستخدمة

### 8.1 النتيجة

لا توجد عناصر غير مستخدمة مؤكدة يمكن حذفها بأمان الآن:

- Knip: لا unused files أو dependencies أو exports مؤكدة.
- TypeScript `noUnusedLocals` و`noUnusedParameters`: يمران.
- ESLint unused rules: تمر.
- لا `TODO` أو `FIXME` أو `HACK` أو `NotImplemented` تنفيذي مؤكد في مسار الإنتاج.

### 8.2 قواعد الحذف الآمن لاحقاً

أي مرشح حذف يجب أن يمر بالترتيب الآتي:

1. يثبت Knip/AST أنه بلا مراجع ثابتة.
2. يُبحث عنه في dynamic imports وregistries وFastify plugins وCLI/scripts وDocker/workflows.
3. يُبحث عن اسمه في docs وpackage exports والعقود العامة.
4. يضاف characterization test أو snapshot للعقد المتأثر.
5. إن كان public، يوضع deprecation وcompatibility shim أولاً.
6. الحذف في PR مستقل مع rollback بسيط، وليس داخل إصلاح تزامن أو migration.

## 9. الدوال والتطبيقات المكررة

### 9.1 التكرار الإنتاجي المطابق

لم يوجد clone إنتاجي طويل (16 سطراً normalized أو أكثر). وُجدت ست مجموعات قصيرة مطابقة أو شبه مطابقة تستحق معالجة انتقائية:

| المجموعة | المواقع | القرار المقترح |
|---|---|---|
| إيقاف runtime صغير | `email-outbox-dispatcher.ts:32` و`upload-reconciler.ts:117` | لا abstraction الآن إلا إذا توحد lifecycle فعلاً |
| callbacks تنظيف قاعدة البيانات | `infrastructure/postgres/database.ts:63,69` | helper محلي صغير |
| تطبيق reading order | `processing/pdf-region-ocr.ts:311` و`processing/pdf-text-operations.ts:216` | helper مشترك typed مع اختبارات اختلاف comparator/index |
| تحميل upload مملوك | `uploads/upload-routes.ts:164,197` | helper محلي يحافظ على error mapping |
| عزل خلفية modal | `features/workspace/useExportReviewDialog.ts:38` و`shared/Dialog.tsx:54` | primitive مشتركة للـ modal/focus |
| تنظيف عزل modal | `useExportReviewDialog.ts:87` و`Dialog.tsx:100` | نفس primitive السابقة |

هناك تنفيذ ثالث قريب في `shared/hooks/useModalDrawer.ts`. هذا ليس مجرد تكرار شكلي؛ اختلاف سلوك focus/inert/aria-hidden قد ينتج مشكلة accessibility. الأفضل primitive واحدة منخفضة المستوى مع بقاء `Dialog` وhooks الحالية كواجهات توافق.

### 9.2 تكرار بنيوي/دلالي يحتاج triage

- `InMemoryProjectOperationLock.run` و`UploadOperationLock.run`: مرشح قوي لـ `KeyedOperationLock` عام، مع re-export للاسمين الحاليين.
- `lockProject` في `postgres-upload-cancellation.ts:157` و`postgres-upload-finalization.ts:189` و`postgres-upload-integrity-failure.ts:200`: helper PostgreSQL داخل bounded context نفسه.
- `toIso` موجود مركزياً في `infrastructure/postgres/database.ts:87` ومكرر محلياً في `postgres-character-job-repository.ts:231`: استيراد الموجود أفضل.
- `listByProjectIds` وstatus summaries في مستودعات export/processing/upload: التشابه حقيقي، لكن توحيد SQL generic قد يضعف الوضوح؛ يحتفظ به حتى يظهر تغيير متزامن متكرر.
- canonical/stable JSON موزع بين Character وidempotency: يجب توحيده لأنه boundary أمني/تشغيلي، لا لمجرد تقليل الأسطر.
- wrappers باسم `run()` في اختبارات topology/rollback وخدمات صغيرة: لا تُدمج اعتماداً على الاسم وحده.

### 9.3 التكرار في الاختبارات

الفحص عبر 552 ملف source/test وجد 17 clone block بطول 16 سطراً أو أكثر، بإجمالي 304 أسطر. كلها في الاختبارات ومعظمها fixture/setup:

1. `app.auth.test.ts:153` ↔ `exports/export-repository.test.ts:9`.
2. `app.character-rig.test.ts:245` ↔ `character-bible-service.test.ts:73`.
3. `app.exports.test.ts:148` ↔ `app.exports.test.ts:223`.
4. `app.exports.test.ts:148` ↔ `app.exports.test.ts:367`.
5. `app.exports.test.ts:223` ↔ `app.exports.test.ts:367`.
6. `app.processing-tools.test.ts:127` ↔ `pdf-region-ocr.test.ts:114`.
7. `app.processing-tools.test.ts:127` ↔ `processing-service.tools.test.ts:351`.
8. `app.processing.test.ts:38` ↔ `app.processing.test.ts:246`.
9. `app.project-review.test.ts:120` ↔ `postgres-project-review.integration.test.ts:182`.
10. `character-job-executor.test.ts:159` ↔ `http-character-inference-provider.test.ts:136`.
11. `character-job-executor.test.ts:161` ↔ `character-reference-service.test.ts:79`.
12. `character-reference-service.test.ts:79` ↔ `http-character-inference-provider.test.ts:138`.
13. `export-service.test.ts:297` ↔ `export-service.test.ts:331`.
14. `postgres-s3.integration.test.ts:362` ↔ `postgres-s3.integration.test.ts:395`.
15. `pdf-region-ocr.test.ts:105` ↔ `processing-service.tools.test.ts:342`.
16. `upload-finalization.test.ts:15` ↔ `upload-integrity-failure.test.ts:77`.
17. `packages/presets/src/index.test.ts:159` ↔ `packages/presets/src/index.test.ts:215`.

**القرار:** إنشاء builders فقط للـ domain fixtures المستقرة. لا تُخفى assertions أو ترتيبات مهمة داخل helper عام، ولا تكون إزالة تكرار الاختبار سابقة لإصلاحات P1.

## 10. التغطية والتحقق

تشغيل coverage workspaces نجح في **588 اختباراً**. أهم النتائج:

- API: 343 اختباراً؛ Statements 67.23%، Branches 58.84%، Functions 69.48%، Lines 68.68%.
- حدود API الحالية: 65% / 58% / 68% / 67%؛ الهامش محدود، خصوصاً branches.
- Web: 131 اختباراً؛ الأرقام موضحة في P2-5 وحدودها منخفضة.
- بقية workspaces والعاملين: 114 اختباراً إضافياً ناجحاً.

تحذيران لا يفشلان الاختبارات لكن يجب تسجيلهما:

1. pdfjs يحذر من غياب `standardFontDataUrl` في اختبار OCR إقليمي؛ `pdf-source.ts` لديه خيارات أكثر حتمية من `pdf-region.ts`.
2. Fontconfig غير موجود في صورة audit النحيفة، بينما Docker runtime يثبته. يجب فصل متطلبات QA عن runtime وإضافة اختبار no-warning إذا كانت الخطوط تؤثر في reproducibility.

Corpus OCR الحالي: 91 عينة، 20 كتاباً، 136 بُعداً. Regional OCR يظل مغلقاً عمداً؛ CER التاريخي للـ holdout هو 27.02% مقابل هدف أقل من 25%. هذه ليست دالة ميتة، بل feature غير مؤهلة للتفعيل.

## 11. خطة التنفيذ المتتابعة مع الحفاظ على المسارات والدوال والأدوات

### المرحلة 0 — تثبيت خط أساس العقود

**الهدف:** منع أي refactor من كسر API أو الأدوات.

1. إنشاء snapshots آلية لـ API routes/OpenAPI paths وpackage exports وnpm scripts وworker entrypoints وDocker targets وmigration checksums.
2. توثيق dynamic registries والـ feature flags والمداخل التي لا يراها Knip بسهولة.
3. تسجيل baseline للحجم والتغطية والـ bundle والاختبارات.
4. إبقاء Character وregional OCR مغلقين.

**معيار الخروج:** أي حذف/تغيير اسم يكسر gate آلية قبل الدمج؛ لا فرق وظيفي عن `c168e5c`.

### المرحلة 1 — اختبارات توصيف وفشل لـ Character قبل الإصلاح

1. إنشاء harness PostgreSQL + object storage للمهاجرتين 038-039.
2. كتابة اختبارات فاشلة حالياً لـ training configuration، hash عبر ترتيب المفاتيح، two-worker lease loss، generation/job concurrency، version allocation، وsame-size artifact tamper.
3. إضافة اختبار swap لعلاقة part/SHA وأبعاد canvas، واختبار review replay المتزامن.

**معيار الخروج:** كل عيب P1 له اختبار يعيد إنتاجه؛ الاختبارات القائمة لا تتغير توقعاتها لإخفاء المشكلة.

### المرحلة 2 — إصلاح سلامة البيانات والتزامن

الترتيب داخل هذه المرحلة مهم:

1. توحيد canonical JSON/fingerprint في utility محايدة مع golden tests.
2. إصلاح reuse لإعداد التدريب وإنشاء model version جديد عند تغير fingerprint.
3. تحويل عمليات repository الحساسة إلى outcomes صريحة، ثم إصلاح uniqueness/idempotency/version allocation داخل transactions/locks.
4. إضافة lease-fenced atomic commit لنتائج model/generation/rig مع cleanup للـ artifacts المرفوضة.
5. إضافة مقارنة SHA عند تنزيل artifact.

**الحفاظ على التوافق:** interfaces العامة القديمة يمكن أن تبقى adapters مؤقتة؛ لا تغيير route أو payload في هذه المرحلة.

**معيار الخروج:** اختبارات المرحلة 1 كلها خضراء، وrace tests مستقرة بالتكرار، ولا 500 متوقع بسبب conflict، ولا stale write بعد lease loss.

### المرحلة 3 — استكمال العقود والهوية التشغيلية

1. إكمال OpenAPI typed لجميع مسارات Character التسع.
2. توحيد مصدر application/build version وإظهار tag + SHA.
3. تحديث `PRODUCTION_READINESS.md` لنقطة الأساس الجديدة فقط بعد الأدلة.
4. توضيح أن `dev:stack` لا يشغّل Character worker تلقائياً، وتوثيق `dev:worker-character` ومتطلبات المزود.
5. تثبيت سياسة URL للمزود واختبار path prefixes.

**معيار الخروج:** contract snapshots تمر، والتوثيق لا ينسب دليلاً تاريخياً إلى commit أحدث، وstaging verifier يفشل عند عدم تطابق الإصدار.

### المرحلة 4 — تقوية الواجهة وتقليل التعقيد

1. journeys feature-enabled لـ `CharacterStudioDialog` تشمل create/reference/train/generate/review/compile، حالات الفشل وإعادة المحاولة.
2. اختبارات keyboard/focus/aria-hidden/inert وإغلاق dialog واستعادة focus.
3. تقسيم `CharacterStudioDialog` إلى state/use-cases ومكونات عرض صغيرة مع إبقاء export الحالي.
4. بعد ذلك فقط: `Workspace` و`WorkspaceEditorLayout` و`AuthGateway` و`LayerDock` و`ExportReview` بحسب المخاطر.
5. رفع thresholds تدريجياً وإضافة budget على مستوى الدالة/المكوّن.

**معيار الخروج:** لا ملف تفاعلي حرج عند 0%، ومسارات accessibility الأساسية مثبتة، ولا تغير في واجهة الاستيراد الحالية.

### المرحلة 5 — إزالة التكرار الآمنة

ترتيب الدمج المقترح:

1. `toIso` وcallbacks/helpers المحلية البسيطة.
2. canonical JSON المشترك إن لم يُنجز في المرحلة 2.
3. primitive عزل/focus للـ modal مع adapters للواجهات الثلاث.
4. `KeyedOperationLock` مع re-export للاسمين القديمين.
5. helper `lockProject` داخل upload PostgreSQL.
6. helper reading-order مع اختبارات domain.
7. builders لاختبارات Character/PDF/upload عندما تقلل تكلفة التغيير فعلاً.

**لا يُدمج الآن:** status-summary SQL أو dispatchers أو generic repository لمجرد التشابه؛ كلفة abstraction أعلى من التكرار الحالي.

**معيار الخروج:** كل خطوة PR مستقل، نفس route/export snapshots، لا انخفاض تغطية، ولا تغير error codes أو lock semantics.

### المرحلة 6 — بيئة CI/QA قابلة لإعادة الإنتاج

1. صورة QA تحتوي Git ومتطلبات `verify:clean` وأدوات الاختبار، منفصلة عن runtime.
2. توحيد خيارات pdfjs وتوفير standard fonts بشكل حتمي عند الحاجة.
3. تشغيل quality الكامل في أمر واحد داخل الصورة، مع حفظ artifacts والتقارير.
4. تشغيل race/fault tests عدة مرات لرصد flakiness.

**معيار الخروج:** `npm run quality` يمر end-to-end داخل بيئة نظيفة ولا يعتمد على أدوات موجودة صدفة على المضيف.

### المرحلة 7 — البوابات الخارجية ثم التفعيل التدريجي

1. تجهيز PostgreSQL وRedis وS3-compatible storage وSMTP موثوقة مع TLS وsecrets manager.
2. نشر staging بنفس digest المرشح للإنتاج.
3. تشغيل migrations المتزامنة، durable integration، backup/restore، fault injection، rollback drill، وload/memory tests.
4. ربط مزود Character inference خاص، وتثبيت timeout/retry/rate limits والـ egress policy.
5. Character Animator Golden حقيقي ومراجعة PSD/manifest، ومراقبة heartbeat/lease/retry/artifact cleanup.
6. legal/privacy/retention approval وStripe live فقط بعد موافقة العمل.
7. canary داخلي لـ Character، ثم نسبة صغيرة، ثم توسيع مع kill switch فوري.

**معيار الخروج:** RTO/RPO مقاسان، rollback مجرب لنفس digest، dashboards/alerts تعمل، ولا P1 مفتوح، ثم فقط يتحول قرار Character من No-Go إلى Go.

## 12. استراتيجية PRs والعودة

- PR-0: snapshots وخط الأساس فقط.
- PR-1: اختبارات Character PostgreSQL والتزامن فقط.
- PR-2: canonical fingerprint + training reuse.
- PR-3: repository outcomes + transactions/idempotency.
- PR-4: lease fencing + artifact cleanup.
- PR-5: download SHA + compiler/review correctness.
- PR-6: OpenAPI/version/docs.
- PR-7 وما بعده: UI coverage ثم refactors والتكرار.

كل PR يجب أن يحتوي: الخطر، الاختبار السابق واللاحق، أثر migration إن وجد، خطة rollback، وتأكيد بقاء feature flag مغلقاً. لا يُجمع تغيير schema وتغيير route وإعادة تسمية public export وإزالة helper في PR واحد.

## 13. مصفوفة التحقق المطلوبة

| البوابة | الأمر/الدليل | متى تكون إلزامية |
|---|---|---|
| تنسيق ومسارات وأنواع | lint + stylelint + typecheck + static path scan | كل PR |
| كود غير مستخدم | Knip + TS unused + registry audit | كل refactor/حذف |
| عقود | route/OpenAPI/package/script snapshots | كل PR |
| اختبارات | workspace tests + coverage | كل PR |
| بناء | all-workspace build + web bundle | كل PR |
| قاعدة البيانات | migration integrity + concurrent migrations + PostgreSQL integration | كل migration/repository change |
| تزامن Character | two-worker lease/idempotency stress | PRs 3-5 وقبل التفعيل |
| artifacts | SHA tamper + cleanup + S3 integration | PRs 4-5 وقبل التفعيل |
| حاويات | container build + topology + SBOM/scan | كل release candidate |
| تشغيل | load/fault/recovery/rollback | staging وقبل الإنتاج |

## 14. القرار النهائي

1. **لا توجد الآن حاجة إلى حذف ملفات أو دوال**؛ أدوات dead-code لم تثبت مرشحاً آمناً.
2. **لا توجد مسارات ثابتة مكسورة مؤكدة**؛ أي تعديل للمسارات يجب أن يبدأ بلقطة عقود للحفاظ عليها.
3. **قرار دمج Character Rig كان معمارياً قابلاً للدفاع عنه لأنه fail-closed ومعزول**، لكنه أضاف bounded context إنتاجياً لم يحصل بعد على دليل PostgreSQL/lease كافٍ.
4. **الأولوية ليست التنظيف الشكلي**؛ الأولوية هي اختبارات Character الحقيقية، ثم سلامة التزامن والـ artifacts، ثم العقود، ثم التغطية، ثم إزالة التكرار.
5. **النشر العام يظل مشروطاً** بالبوابات الخارجية وبإصدار evidence يطابق commit/digest الحاليين، ولا يجوز الاعتماد على تقارير v0.1.3 أو v0.1.7 لتفويض commits اللاحقة تلقائياً.

بهذا الترتيب نحافظ على المسارات والدوال والأدوات الحالية، ونحوّل كل إصلاح إلى تغيير صغير قابل للاختبار والعودة، من دون إزالة سلوك مستخدم أو كسر تكامل خارجي بصورة غير مرئية.
