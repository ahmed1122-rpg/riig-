# التدقيق الشامل لمسارات الإنتاج والكود والطبقات وخطة الإغلاق النهائي — 2026-08-13

## 1. الملخص التنفيذي

الحكم الحالي على الشفرة الموجودة في مساحة العمل هو **NO-GO للنشر العام**. البناء نفسه ينجح، لكن بوابة الإصدار الكاملة لا تنجح، ومرشح الإصدار غير مثبت أو نظيف أو مربوط بصور موقعة تخص هذا التغيير.

لا توجد نتيجة مؤكدة من مستوى P0 مثل تجاوز مصادقة مباشر أو فقد بيانات وقع بالفعل. توجد، مع ذلك، عوائق P1 متعددة تمس اتساق البيانات، الذرية، حفظ تعديلات الطبقات، صدق المعاينة والتصدير، قابلية تشغيل PDF الكبير، عزل الأسرار، صحة العمال، وموثوقية الإصدار.

أهم قرار عملي: لا ينبغي إصلاح هذه القائمة في دفعة ضخمة واحدة. المطلوب أولًا إغلاق سلامة البيانات وبوابات الإصدار، ثم توحيد عقد الطبقات والمعاينة، ثم الأداء وتجربة المستخدم، وأخيرًا أدلة staging والإطلاق.

## 2. نطاق التدقيق ومنهجيته

شمل الفحص:

- `apps/api` و`apps/web` والعمال الأربعة.
- حزم contracts وpresets وdocument/media processing وguidance وexport adapters.
- 41 migration SQL وعقود API والإصدار.
- Docker وCompose وNginx وGitHub Actions والمراقبة والاسترداد والـrunbooks.
- الرفع والمعالجة والتصدير والحسابات والفوترة وMFA والكاش وpolling.
- الشجرة والتسمية والترتيب والبحث والتحديد والمعاينة وmerge/split وundo/redo وmobile/RTL.

الجرد المباشر وجد 814 ملفًا خارج `node_modules/dist/coverage/artifacts`، منها 443 ملف TypeScript و81 TSX و41 SQL و198 ملف اختبار/مواصفة. تم فحص المصدر الحالي عند SHA `8e5dc7d7a3a60e5272219a4ac98fbc8b41c0478c` على الفرع `codex/sequenced-remediation`، مع 124 مدخلًا معدلًا/غير متتبع. لذلك الأدلة التاريخية للإصدار `v0.1.7` لا تثبت هذا المرشح.

مقياس الأولوية:

- **P0:** اختراق/فقد بيانات مؤكد أو توقف شامل.
- **P1:** مانع نشر أو خطر سلامة/أمن/مسار أساسي بلا workaround موثوق.
- **P2:** خلل مهم أو دين تشغيلي له workaround.
- **P3:** تحسين وصيانة وتجربة استخدام.

## 3. نتائج البوابات المنفذة

| البوابة | النتيجة | الدليل المختصر |
|---|---:|---|
| بناء كل workspaces | ناجح | API/web/packages/workers بُنيت؛ web workspace نحو 167.9 KiB raw للchunk |
| TypeScript | ناجح | جميع workspaces |
| ESLint / Stylelint | ناجح | صفر warnings |
| Architecture | **فاشل** | cycle: `WorkspaceChrome → WorkspaceMobileSheet → WorkspaceChrome` |
| Dead code | **فاشل** | exportان غير مستخدمين في `layerPageScope.ts:30,34` |
| API unit suite | **فاشل** | 384/385؛ توقع قديم لخلفية PDF في `app.processing.test.ts:454` |
| Coverage | **فاشل** | السبب نفسه في API؛ web نجح عند 46.88/44.35/39.61/48.51 |
| Web tests | ناجح | 47 ملفًا و176 اختبارًا في تشغيل coverage |
| Bundle budget | **فاشل** | JS gzip ‏169.8 KiB مقابل 168.0 KiB |
| Maintainability | ناجح مع دين | 421 ملفًا، 0 تجاوز، 0 clones، و26 تحذيرًا بين 450–550 |
| Contracts | ناجح | 75 عملية API و41 migration |
| Deployment/recovery/incident contracts | ناجح | فحوص محلية للعقود والملفات |
| OCR strict release gate | **فاشل/معطل** | implementation digest قديم؛ يجب إبقاء regional OCR معطلًا |
| npm audit | ناجح | صفر ثغرات معروفة ضمن 698 dependency entry وقت الفحص |
| E2E | **غير موثوق وفاشل** | 4 سيناريوهات موثقة ثم مهلة 15 دقيقة؛ API القائم انقطع، واختبار الهاتف استخدم accessible name قديمًا |
| Prometheus rules | غير مثبت محليًا | Docker API غير متاح لهذه الجلسة |
| Managed staging/restore/load | **مفقود** | موثق صراحة في `PRODUCTION_READINESS.md` |

### تفسير E2E

التشغيل الأول رفض البدء لأن المنفذ 4000 مستخدم. التشغيل مع `PLAYWRIGHT_REUSE_SERVER=true` أعاد استخدام API ليس مملوكًا للاختبار ثم انقطع أثناء الجولة؛ لذا فشل التسجيل والفوترة ليس دليل منتج مستقلًا، بل **فشل عزل وتشغيل E2E** يجب إصلاحه. فشل الهاتف عند البحث عن accessible name مطابق تمامًا `+جزء_05` بينما الزر الجديد اسمه `+جزء_05، محددة`؛ الطبقة كانت مرئية فعلًا في الصورة. هذا regression في عقد الاختبار/الوصول، لا اختفاء بصري للطبقة.

## 4. موانع النشر الفورية

### P1-01 — مرشح الإصدار غير ثابت

- الدليل: الشجرة dirty، النسخة ما زالت 0.1.7، بينما `docs/VERSIONING.md:32-33` يوضح أن التغييرات غير الموسومة ليست الإصدار المستضاف.
- الأثر: لا يمكن ربط نتائج CI أو SBOM أو التوقيع أو rollback بهذه الشفرة.
- الإصلاح: إغلاق بقية P1، تنظيف الشجرة، رفع النسخة إلى مرشح جديد، commit/tag، وبناء الصور من SHA نفسه.
- القبول: `git status` نظيف، tag/نسخ workspaces متطابقة، وكل تقرير وصورة يحتويان SHA نفسه.

### P1-02 — بوابة quality نفسها مكسورة

- cycle مؤكد بين `WorkspaceChrome.tsx` و`WorkspaceMobileSheet.tsx` بسبب إعادة التصدير واستيراد type.
- اختبار API الشامل ما زال يفترض أن `layers[0]` خلفية، بينما العقد الجديد يضع group الصفحة أولًا.
- `knip` يجد `isStructuralLayer` و`layerPageNumber` كصادرات عامة بلا مستهلك خارجي.
- JS يزيد 1.8 KiB عن budget؛ لا ترفع budget قبل معرفة مساهمة كل chunk.
- القبول: `npm run quality` ينجح من البداية للنهاية مرتين على checkout نظيف.

### P1-03 — استعادة source أثناء job نشط قد تعلق المشروع busy

- الدليل: `postgres-source-version-restore.ts:77-140` يغير current source، بينما `project-job-status.ts:20-52` و`project-repository.ts:271-285` يبقيان active job/fence القديم.
- السيناريو: استعادة نسخة أثناء job؛ نتيجة job القديم تُرفض بسبب source mismatch، لكن fence لا يزول، فيبقى المشروع مشغولًا.
- الإصلاح: restore transaction يرفض active jobs أو يلغيها/يصرفها ذريًا ويزيل fence وفق state machine واحدة.
- القبول: سباق restore مقابل إكمال job لا يترك `active_job_id` ولا busy دائمًا.

### P1-04 — إنشاء job وتفعيل project fence غير ذريين

- الدليل: `processing-service.ts:195-224` و`export-service.ts:205-214`، مع claim في `processing-job-claim.ts:83-94` لا يجعل فشل fence سببًا لرفض المعالجة.
- السيناريو: crash بعد insert وقبل fence يترك job يتيمًا أو يعالج source قديمًا.
- الإصلاح: transaction واحدة لـjob+fence، أو outbox/state transition مع CAS إلزامي أثناء claim.
- القبول: fault injection بين الخطوتين ينتج إما job كاملًا fenced أو لا job؛ لا حالة وسطى.

### P1-05 — حذف الحساب قد يترك object خاصًا يتيمًا

- الدليل: snapshot للمفاتيح قبل تصريف jobs في `postgres-account-privacy-repository.ts:250-304,337-383,393-443` و`account-privacy.ts:91-114`.
- السيناريو: worker يكتب object بعد snapshot ثم تُحذف rows؛ يبقى object بلا مرجع ويمس حق الحذف.
- الإصلاح: tombstone للحساب، منع claims/writes، انتظار leases، ثم inventory نهائي transactionally قبل purge؛ reconciliation بعدي.
- القبول: حذف متزامن مع processing/export لا يترك أي prefix أو row أو job، مع audit manifest.

### P1-06 — retention يحذف الأصل قبل إثبات أنه ما زال بلا مرجع

- الدليل: `retention-cleanup.ts:223-250,420-454`.
- السيناريو: edit يضيف مرجعًا بعد listing وقبل delete؛ mark اللاحق يرفض لكن object حُذف بالفعل.
- الإصلاح: claim deletion/CAS في DB أولًا، ثم delete object، ثم finalize؛ أو quarantine مع grace period.
- القبول: سباق reference-add مع cleanup لا ينتج layer يشير إلى object مفقود.

### P1-07 — استهلاك MFA challenge وrecovery code غير ذري

- الدليل: read ثم delete في `auth-service.ts:217-252` وSELECT عادي في `postgres-auth-repository.ts:300-312`؛ recovery read-modify-write في `auth-service.ts:508-527`.
- الأثر: طلبان متزامنان قد يستخدمان الرمز نفسه وينشئان جلستين.
- الإصلاح: `DELETE ... RETURNING`/CAS داخل transaction، وإزالة recovery hash ذريًا.
- القبول: 20 طلبًا متزامنًا ينتج نجاحًا واحدًا فقط.

### P1-08 — أسرار وصلاحيات الإنتاج أوسع من الحاجة

- `compose.production.yaml:3-159` يمرر ملف أسرار واحدًا للخدمات والعمال والمهاجر.
- migrations وruntime يشتركان في `DATABASE_URL`، ما يجبر التطبيق على DDL أو يفشل migration عند التضييق.
- التوصية الحالية لـS3 تمنح get/put/delete عبر prefixes واسعة.
- الإصلاح: secret sets وهويات DB/S3 مستقلة لكل workload، و`MIGRATION_DATABASE_URL` منفصل.
- القبول: media worker لا يرى Stripe/SMTP/AUTH ولا يحذف artifacts؛ API runtime لا يستطيع DDL.

### P1-09 — رفع 30MiB كامل داخل ذاكرة API دون backpressure كافٍ

- الدليل: `upload-routes.ts:102-105,207-222` يجمع Buffer كاملًا؛ memory ceiling ‏768MiB؛ rate limit لا يساوي concurrency limit.
- الأثر: دفعة uploads متزامنة قد تسبب OOM. قيمة 30MiB نفسها متسقة وليست الخطأ.
- الإصلاح: streaming multipart إلى staging object مع hash/size ثم publish ذري. مرحليًا semaphore عالمي/per-user وedge concurrency limit.
- القبول: 20×30MiB تحت memory budget، 31MiB=413، والإلغاء بلا orphan.

### P1-10 — healthcheck العامل لا يثبت instance نفسه

- الدليل: `check-worker-health.mjs:45-54` يبحث بالنوع، بينما كل worker له instance ID مستقل.
- الأثر: نسخة ميتة قد تبدو healthy بسبب heartbeat نسخة أخرى.
- الإصلاح: health query بالـinstance/release أو heartbeat محلي مربوط بالعملية.
- القبول: قتل عامل من نسختين يجعل حاويته وحدها unhealthy.

### P1-11 — لا توجد ذرية موحدة لعمليات الوثيقة في الواجهة

- `useWorkspaceOperations.ts` و`useWorkspaceLayerMutations.ts` يملكان locks منفصلة؛ undo/redo وsegmentation لا يملكان coordinator واحدًا.
- الأثر: merge/OCR/undo قد تنطلق على base revision واحدة وتنتج conflict أو adoption قديم.
- الإصلاح: `DocumentCommandCoordinator` واحد يملك mutex، phase، queue/cancel، operation ID وسياسة stale result.
- القبول: عمليتان متعارضتان تنتجان request واحدًا أو queue حتميًا، ولا تتبنى نتيجة stale.

### P1-12 — قد تضيع مراجعة طبقة عند استبدال source

- autosave مؤجل 700ms في `useWorkspaceReviewAutosave.ts:183`؛ replace في `useWorkspaceUpload.ts:26,128` لا يعمل flush له قبل تبني الوثيقة الجديدة.
- الإصلاح: dirty-review guard + `flushReview()` قبل upload intent، وفشل الحفظ يمنع الاستبدال أو يعرض قرارًا صريحًا.
- القبول: PATCH للمصدر القديم يسبق POST upload intent في اختبار السباق.

## 5. الطبقات: التسمية والترتيب والعرض والمعاينة والتعديل

### P1 — قائمة PDF لا تتحمل العقد الأقصى

- العقد يسمح 250 صفحة/100,000 نص (`core-contracts.ts:9`). `layerPageScope.ts:73` يعيد filter للطبقات لكل صفحة، و`PdfPageLayerTree.tsx:56` يركب كل العقد حتى المطوية.
- الإصلاح: index واحد `byPage/byParent`, flatten للصفوف المرئية، virtualization، عدم mount للأبناء المطويين، debounce/worker للبحث.
- القبول: fixture 100k؛ DOM أقل من 300 row، ولا long task فوق budget، والبحث يبقى تفاعليًا.

### P1 — العمليات الجماعية تتجاوز حد API ‏1000

- normalize/reverse/reading order في `LayerDock.tsx:281,448` يمكن أن تعدل آلاف الطبقات؛ autosave يرسل PATCH واحدًا، بينما `processing-route-support.ts:47` يرفض >1000.
- الإصلاح المفضل: commands server-side ذرية مع scope (`page/folder/document`) وpreview. لا تقسيم blind PATCH بلا rollback.
- القبول: normalize/reorder لـ5000 طبقة ينجح بالكامل أو لا يغير شيئًا.

### P1 — معاينة PDF لا تطابق الرؤية والشفافية وSolo

- `PdfGuidanceEditor.tsx:136,258` يرسم النصوص بلا visibility/opacity؛ التصدير يطبقها في `ExportReviewPreviews.tsx:70`.
- الإصلاح: projection موحد للطبقات تستخدمه workspace/export؛ pass active/hidden/solo/opacity.
- القبول: hide/opacity/solo يطابق screenshot التصدير لحظيًا.

### P1 — preflight التصدير يقدم نجاحًا زائفًا

- `ExportQualitySummary.tsx:7-33` يعلن صحة الاسم والخلفية دائمًا ولا يستقبل layers.
- `ExportReviewHeader.tsx:36-38` يعرض «جاهز للتصدير» دون حالة الحفظ أو blockers.
- `layerChecks.ts:33-37` يستخدم `every` على قائمة قد تكون فارغة، فينجح PDF بلا background.
- الإصلاح: canonical preflight نتيجة `ready/warning/blocked` من domain مشترك أو endpoint، مع منع export على blocker.
- القبول: اسم ممنوع/مكرر، parent graph معيب، PDF بلا background، أو save failed تظهر قبل POST export.

### P1 — عقد التسمية غير موحد

- `LayerDock` يستخدم preset normalizer، بينما `ExportReview.tsx:150-156,374` يضيف `+` فقط ويكتب مع كل keystroke. الخادم يرفض slash/control والطول.
- الإصلاح: package domain واحد: normalize + validate + duplicate strategy + reserved names؛ commit عند Enter/blur فقط؛ batch rename preview.
- سياسة مقترحة للأسماء:
  - root: `+page_001` (تقني ثابت، label عربي منفصل).
  - background: `+page_001_background`.
  - semantic folders: `+heading_001`, `+topic_001`, `+body_001` داخل الصفحة.
  - text: اسم مفهوم مشتق من النوع/الترتيب، مع ID ثابت منفصل عن الاسم.
  - uniqueness داخل parent، وليس المستند كله؛ منع `/ \\ control` وreserved Adobe names.

### P2 — merge/split والتحرير

- الواجهة لا تتحقق مسبقًا من قواعد merge الخادم: نفس الصفحة/الأب/الاتجاه وحد 50 (`pdf-text-operations.ts:112`).
- ExportReview يحتوي merge/split محليين مزيفين ومخفيين غالبًا (`ExportReview.tsx:180-209`)؛ يجب حذفهما لا تركهما latent.
- guidance قد يغير locked/fixed text وينشئ semantic groups فارغة عند مناطق متداخلة (`packages/guidance/src/index.ts:139-195`).
- preflight graph لا يثبت duplicate IDs/orphans/cycles/cross-page parent، بينما PSD قد يسقط/يسطح العقد (`presets/index.ts:114-218`, `pdf-psd.ts:195-269`).
- الإصلاح: `canMergeSelection()` domain مشترك؛ merge/split الحقيقيان server-only؛ graph validator إلزامي قبل save/export؛ منع group فارغ أو fixed mutation.

### P2 — وظائف احترافية ناقصة للطبقات

1. click-to-select ثنائي الاتجاه بين PDF preview والشجرة مع scroll sync.
2. تحرير نص PDF inline مع validation وundo/conflict handling.
3. تعديل bounds والاتجاه والمحاذاة وfont mapping.
4. filters page/type/locked/hidden/low-confidence وsaved views.
5. rename templates مع preview للتعارضات وscope واضح.
6. duplicate/orphan/cycle diagnostics وإصلاح مقترح.
7. before/after diff بعد OCR/refinement/merge/split.
8. command log مرئي: pending/saved/retried/failed/revision.
9. multi-page batch hide/lock/normalize مع estimate وعدد العناصر.
10. sticky page header وbreadcrumb ومسار parent في القوائم الكبيرة.

### P2 — الهاتف لا يملك parity كافية

- `WorkspaceMobileSheet.tsx:88` يقدم اختيار الصف فقط؛ rename/hide/lock/opacity/reorder/search/filter غير متاحة كما في desktop.
- bottom sheet يفتقد disclosure semantics كاملة، Escape وfocus return.
- الإصلاح: LayerRow مشترك وaction drawer للهاتف، مع `aria-expanded/controls` وfocus management.

### P2/P3 — تناقضات تجربة الاستخدام

- تأكيد تغيير صفحة PDF قد يظهر مرتين بسبب حارسين في المحرر والأب.
- segmentation لا يصفر markers المحلية بعد تبني الوثيقة الجديدة.
- revision/review state قد يبقى قديمًا بعد undo/redo.
- ألوان الطبقات مشتقة من index وقد تتغير بعد reorder؛ استخدم hash من stable ID.
- «سريع/كامل» في المعاينة يغير filter CSS فقط، لا أصلًا أو دقة؛ الاسم مضلل.
- «ملاءمة 74%» قيمة ثابتة وليست قياسًا.
- export expired يظهر ready مع download معطل ولا re-export path.
- PDF Object URL يُنشأ ولا يستهلك، وقد يحتجز 30MiB.

## 6. الأمن والمصادقة والخصوصية

### P1

- لا يوجد email verification فعلي: التسجيل ينشئ active session مباشرة رغم وجود `pending_verification` في schema. كذلك لا يوجد bootstrap إداري production موثق وآمن.
- key encryption واحد بلا key ID أو keyring؛ rotation قد يعطل MFA/recovery المخزن، ولا يوجد rotation drill.
- لا توجد audit events دائمة كاملة لتغيير password/MFA/reset.
- migrations قد تعلق على advisory/DDL lock بلا timeout محدد (`migrate.ts:23-27,101-114`).

### P2

- password hash `scrypt$salt$key` بلا version ومعلمات cost أو rehash تدريجي.
- لا توجد سياسة Pino redaction مختبرة لحقول authorization/cookie/password/token.
- CSP يسمح `unsafe-inline` للstyles؛ يوجد 17 inline style ويجب الانتقال تدريجيًا عبر report-only.
- SECURITY.md لا يقدم قناة خارجية قابلة للاستخدام.
- لا توجد بوابة تراخيص SPDX/NOTICE للتبعيات.

### نقاط قوة مثبتة

- production config fail-closed لـPostgres/TLS/rediss/HTTPS/Secure cookie/SMTP TLS/S3 encryption+versioning/worker mode/OCR local.
- CORS origin محدد، mutation-origin guard، rate limiting Redis-backed.
- session cookie HttpOnly/Secure production/SameSite=Lax.
- HSTS/frame-ancestors/nosniff موجودة.
- Docker non-root/read-only/cap-drop/no-new-privileges، bases digest-pinned.
- CodeQL/Gitleaks/Trivy/SBOM/provenance/Cosign workflows موجودة تصميميًا.
- `npm audit` أعاد صفر CVE معروف وقت الفحص؛ هذا snapshot لا يغني عن CI الدوري.

## 7. المزامنة والكاش والمهام

### P1/P2

- لا يوجد scheduler موحد للـpolling؛ `ProjectsView` وworkspace ينفذان polling مستقلًا، دون ضمان توقف hidden tab أو dedup المورد نفسه.
- لا توجد query cache مركزية أو invalidation contract؛ لا أنصح بإضافة مكتبة قبل تعريف ownership وfreshness لكل resource.
- المطلوب: request registry keyed by resource، AbortController، visibility/online awareness، exponential backoff+jitter، احترام Retry-After، ETag/If-None-Match حيث يدعم الخادم.
- source/job/review state يجب أن يملك version token واحدًا؛ لا optimistic UI بلا rollback أو reconciliation.
- readiness API لا تعكس media/document/export workers؛ أضف capability degraded state بدل إسقاط API كله.
- API shutdown 15s لا يطابق Nginx upload 120s وCompose grace 45s؛ يلزم deregistration+drain policy.
- مسارا رفع PDF وإنشاء بعض مخرجات التصدير يعتمدان على Buffers كبيرة في الذاكرة دون backpressure وdeadline موحدين؛ يجب اعتماد streaming وحدود تزامن مستقلة للرفع والتصدير وقياس peak RSS تحت الحمل.

### الكاش الحالي الجيد

- API/internal responses no-store.
- الأصول المبنية immutable.
- raster الخاصة private immutable + ETag.
- Redis مستخدم للrate limits/login attempts وليس كمصدر حقيقة للبيانات الدائمة.

## 8. الإنتاج والنشر والمراقبة

### P1

- readiness workflows لا تعمل checkout صريحًا لـ`RELEASE_GIT_SHA`، وقد تفحص scripts من default branch ضد release آخر.
- release workflow اليدوي يمكنه توقيع branch build دون tag gate صارم.
- preflight لا يفرض `API_PORT=4000` و`PDF_OCR_MODE=local` رغم افتراض Nginx/runtime لهما.
- Prometheus لا يحتوي `up == 0`/`absent()`/dead-man switch؛ اختفاء API قد يخفي المقاييس نفسها.
- الأدلة الخارجية المفقودة: managed staging، نشر digests نفسها، backup/restore موقع RPO≤15m/RTO≤4h، representative 30MiB load/memory، provider/fault drills.

### P2

- `/healthz` للويب يعكس Nginx فقط، لا API readiness؛ أضف `/readyz`.
- Compose أحادي المضيف؛ صالح pilot فقط إذا SLA يصرح بذلك، وليس HA.
- runtime image موحدة توسع attack surface؛ افصل targets عند تبرير كلفة التشغيل.
- bundle gate يقيس JS/CSS فقط؛ أضف initial-route/assets/fonts/request/LCP budgets.
- docs drift: `DEPLOYMENT.md:231` يقول migration 040 بينما العقد يحتوي 041؛ readiness يسجل bundle تاريخيًا 165.2 KiB بينما الحالي 169.8.
- verifiers لبعض workflows تعتمد مطابقة نصية؛ حلل YAML graph بدل string search.
- لا توجد frontend error telemetry فعلية أو hidden source-map upload خاص.

## 9. الصفحات والأدوات الأخرى

- **Billing P1:** عند فشل API قد تعرض Starter/0 كأنها بيانات حقيقية؛ استخدم loading/error/stale/ready ولا تستنتج subscription قبل وصولها.
- **Projects P2:** بحث بلا نتائج يعرض فراغًا؛ أضف no-match + clear filters.
- **Exports P2:** expired export يحتاج status مشتق وفتح المشروع/إعادة التصدير.
- **MFA UI P2:** الرسائل تجمع invalid/expired/server error، وزر verify لا يتعطل عند انتهاء العداد.
- **Mobile layer actions P2:** اختبار E2E الحالي يفترض name قديمًا؛ استخدم locator يراعي aria-label الجديد، لكن الأهم إضافة parity فعلية للأفعال.
- **Icons P3:** بعض الدلالات تشترك في glyph واحد مثل open/close وup/down وlogin/logout؛ افصل الرموز الاتجاهية مع RTL tests.
- **CSS P2:** selector لملاحة PDF مملوك لـexport-review بينما يستخدم workspace؛ انقل الملكية إلى feature، واستمر في cascade layers/CSS modules.

## 10. الملفات الكبيرة والتكرار والمكتبات

- سياسة المستخدم الحالية: warning عند 450، failure فوق 550 سطرًا غير فارغ. هناك 26 warning، أهمها Workspace 500، auth-service/ImageGuidance 499، ExportReview 498، LayerDock 493، processing 494، upload 490.
- المدقق وجد صفر exact clone blocks وفق التطبيع، لكن توجد تكرارات مفاهيمية:
  - حارسا `beforeunload`.
  - download Blob logic في Settings/Session/Admin.
  - تطبيع/validation الأسماء في أكثر من surface.
  - locks/operation state متعددة للوثيقة.
  - polling loops متعددة.
  - preflight rules موزعة بين client/server.
- لا تقسّم الملفات لمجرد العدد؛ استخرج bounded contexts: document commands، layer naming/preflight، mobile/desktop rows، upload streaming، auth MFA consumption، release schema.
- التدقيق البنيوي لشجرة الإنتاج وجد أربع حزم transitive متعددة الإصدارات: `cookie` ‏1.1.1/2.0.1، و`fast-uri` ‏3.1.5/4.1.2، و`process-warning` ‏4.0.1/5.0.0، و`real-require` ‏0.2.0/1.0.0. هذا ليس خطأً وظيفيًا بذاته؛ لا تستخدم overrides قسرية، وشغّل `npm dedupe` في فرع مستقل مع diff للـlockfile واختبارات وقياس bundle.
- updates الصغرى المتاحة تشمل Fastify/Redis/AWS SDK/Vite وغيرها؛ نفذها دفعات صغيرة بعد تثبيت المرشح، ولا تقفز major مثل Zod 4/Lucide 1/TypeScript 7 بلا migration plan.

## 11. خطة الإصلاح النهائية المتسلسلة

### المرحلة 0 — تجميد المرشح وإعادة البوابات (1–2 يوم)

1. فك cycle باستخراج `WorkspaceMobilePanel` إلى ملف types مستقل؛ لا barrel يعيد الاستيراد عكسيًا.
2. تحديث اختبار API لعقد group+background واختبار parentId، وحذف/تضييق exports الميتة.
3. استعادة bundle تحت 168 KiB عبر تحليل chunk/import، لا رفع الحد تلقائيًا.
4. جعل E2E يملك API مع ports معزولة و`NODE_ENV=test` وحالة نظيفة؛ لا reuse لخادم عشوائي.
5. تحديث locator الهاتف ليختبر accessible state الصحيح، ثم `quality` مرتين.

**معيار الخروج:** كل البوابات المحلية خضراء، ولا flaky retry مطلوب.

### المرحلة 1 — سلامة البيانات والذرية (3–6 أيام)

1. transaction لـjob+fence؛ CAS عند claim.
2. state machine لاستعادة source مع active jobs.
3. account tombstone/drain/final inventory.
4. retention claim/quarantine/finalize.
5. MFA/recovery consume ذري.
6. migration lock/statement timeouts.

**معيار الخروج:** race/fault tests تكرر 20–100 مرة بلا orphan أو busy دائم أو double-consume.

### المرحلة 2 — عقد الطبقات الموحد (4–7 أيام)

1. package `layer-domain`: graph validator، naming، duplicate scope، merge eligibility، preflight.
2. server commands ذرية للnormalize/reading order/batch hide-lock.
3. حذف merge/split المحلي المزيف وربط كل structural edit بالخادم.
4. flush review قبل source replacement وDocumentCommandCoordinator.
5. حماية fixed/locked في guidance ومنع empty groups.

**معيار الخروج:** 5000-layer batch atomic؛ invalid graph لا يُحفظ أو يُصدّر؛ cross-page merge يُمنع مبكرًا.

### المرحلة 3 — صدق المعاينة والتصدير (3–5 أيام)

1. projection واحد للرؤية/opacity/solo/order.
2. preflight ready/warning/blocked حقيقي في header/summary/footer.
3. click-to-select وscroll sync وactive highlight.
4. reset segmentation ومزامنة revision/review state.
5. rename commit على blur/Enter مع inline error.

**معيار الخروج:** visual parity workspace/export ولقطات Playwright desktop/mobile/RTL.

### المرحلة 4 — أداء القائمة وتجربة المحترفين (4–8 أيام)

1. فهرسة graph O(n)، visible flatten وvirtualized tree.
2. بحث debounced/worker مع filters وsaved views.
3. mobile action drawer كامل.
4. batch rename preview، diff، diagnostics، command log.
5. ثبات الألوان من ID، وإزالة القيم/خيارات المعاينة المضللة.

**معيار الخروج:** 100k-layer fixture ضمن DOM/long-task/memory budgets.

### المرحلة 5 — أمن وleast privilege (4–7 أيام)

1. secrets/DB/S3 identities منفصلة.
2. email verification وadmin bootstrap one-shot.
3. MFA keyring/rotation/audit trail وpassword hash versioning.
4. log redaction tests، CSP migration، security contact/license gate.
5. streaming upload أو semaphore مؤقت مثبت بالحمل.

**معيار الخروج:** denied-access matrix، rotation drill، 20×30MiB load دون OOM.

### المرحلة 6 — منصة وإطلاق (تعتمد على المالك الخارجي)

1. checkout exact SHA وtag gate وCosign verification داخل wrapper.
2. per-instance worker health، API-down/metrics-absent alerts، readyz/capability health.
3. managed staging وPITR/S3/SMTP/Redis/TLS/IAM.
4. restore/fault/load/rollback drills لنفس digests.
5. رفع version، clean commit/tag، hosted CI، signed images، canary.

**معيار GO النهائي:** لا P1 مفتوح، quality/security/E2E/integration/topology خضراء على SHA نظيف، staging وrestore/load/rollback موقعة، وregional OCR/Character/live billing لا تُفعّل إلا بأدلتها المستقلة.

## 12. ترتيب الأولويات المقترح للـbacklog

| الترتيب | الحزمة | القيمة | المخاطرة إن تأخرت |
|---:|---|---|---|
| 1 | quality/E2E/API contract | مرشح قابل للقياس | لا يوجد baseline صادق |
| 2 | jobs/source/delete/retention/MFA atomicity | سلامة وأمن | orphan، busy دائم، double-use |
| 3 | layer domain + command coordinator | منع تناقضات | حفظ/تصدير وحالة جزئية |
| 4 | preview/preflight/naming | ثقة المستخدم | واجهة تخالف التصدير |
| 5 | PDF virtualization/batch commands | قابلية التوسع | تجمد ملفات صحيحة |
| 6 | least privilege/upload streaming | تقليل blast radius | OOM وتسرب صلاحيات |
| 7 | staging/restore/load/alerts | إثبات التشغيل | نشر غير مسؤول |
| 8 | professional UX/tools | تطور المنتج | بطء العمل اليدوي |

## 13. قرارات لا أوصي بها

- لا ترفع bundle أو coverage أو maintainability baselines لمجرد تمرير CI.
- لا تضف React Query/Redux أو microservices قبل تعريف ownership والعقود؛ coordinator/cache صغيران يكفيان الآن.
- لا تضغط PDF عند الرفع؛ احتفظ بالأصل immutable. ضغط الصور المشتقة والتصدير يتم حسب الصيغة، مع streaming.
- لا تفعّل regional OCR حتى holdout جديد، ولا Character/live billing قبل gates الخاصة.
- لا تستخدم global package overrides لحل transitive duplicates بلا اختبار.
- لا تعتبر Compose أحادي المضيف HA، ولا تعتبر build ناجحًا مساويًا لجاهزية الإنتاج.

## 14. الخلاصة

المشروع يحتوي أساسًا إنتاجيًا قويًا نسبيًا: عقود، migrations، أمن HTTP، عمال durable، object-storage integrity، CI supply-chain، runbooks، وتصدير حقيقي. لكنه الآن في مرحلة **مرشح تطوير متقدم وليس مرشح نشر**. أكبر المخاطر ليست نقص زر أو أيقونة، بل الذرية واتساق الوثيقة والمهام وصدق الواجهة وربط الإصدار بأدلة تشغيل حقيقية. تنفيذ المراحل بالترتيب أعلاه يحول العمل من إصلاحات متفرقة إلى مسار نشر قابل للإثبات والرجوع.
