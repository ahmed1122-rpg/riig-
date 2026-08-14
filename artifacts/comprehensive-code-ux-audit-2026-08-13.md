# التقرير الشامل لمراجعة الكود والوظائف وتجربة الاستخدام — MotionPrep

**تاريخ اللقطة:** 2026-08-13
**الفرع/الالتزام الأساسي:** `codex/sequenced-remediation` عند `8e5dc7d`
**حالة النسخة:** شجرة عمل غير نظيفة: 71 ملفًا متعقبًا متغيرًا (`+1308/-250`) إضافة إلى ملفات جديدة وتقارير.
**قرار الإصدار الحالي:** **غير جاهز للإنتاج أو الدمج كمرشح نهائي** قبل إغلاق P1، جعل بوابة الجودة قابلة للتكرار، ومراجعة التغييرات الحالية في commit صغير قابل للتتبع.

> هذا تقرير فحص واقتراحات فقط. لم تُطبق إصلاحات المنتج ضمن هذه المهمة. النتائج تخص حالة الملفات المحلية الحالية، لا الالتزام الأساسي وحده ولا مستودع GitHub البعيد.

## 1. الخلاصة التنفيذية

المشروع متقدم هندسيًا: معمارية modular monolith واضحة، عقود مشتركة، 12 مساحة npm، 41 ترحيل SQL، عمال منفصلون للمعالجة والتصدير والشخصيات، سياسات fail-closed للإنتاج، اختبارات كثيرة، بوابات عقود/معمارية/نشر/استرداد، وتخزين خاص مع تحقق من النوع والحجم والتوقيع وSHA-256. البناء الإنتاجي وحد الحزمة وفحص ثغرات npm ناجحة.

لكن توجد أربع مجموعات مخاطر تمنع وصف النسخة الحالية بأنها جاهزة:

1. **سلامة الاستئناف:** مساحة العمل الجديدة لا تكتب المشروع الذي أنشأته إلى رابط التطبيق؛ إعادة التحميل تعيد المستخدم إلى مساحة فارغة رغم بقاء البيانات.
2. **الأمن والملاحظة:** لا توجد مرحلة فحص برمجيات خبيثة/حجر للملفات المرفوعة، ولا يوجد جامع أخطاء متصفح مركزي موصول بـ`AppErrorBoundary`.
3. **قابلية التغيير:** حد JavaScript الكلي ممتلئ تقريبًا (167.4 من 168 KiB gzip)، وCSS مبني من طبقات overrides متأخرة، و37 ملف إنتاجي ≥400 سطر فعلي. هذا يجعل إضافة وظائف سليمة تدفع إلى اختصارات دلالية مثل إعادة استخدام أيقونات غير مطابقة.
4. **ثقة الاختبارات:** تغطية API مقبولة بالكاد، وتغطية الويب منخفضة خصوصًا للمسارات الحرجة. بوابة `quality` توقفت في هذه اللقطة بانهيار libuv متقطع على Windows بعد نجاح المراحل السابقة، بينما الاختبار المتسبب نجح منفردًا؛ يجب إصلاح استقرار المشغل لا تجاهل النتيجة.

لم يثبت وجود اعتماديات أو صادرات ميتة: `knip` ناجح. لذلك لا أوصي بحذف أداة حاليًا. الأدوات غير المتاحة للمستخدم هي في معظمها **وظائف مقيدة عمدًا** وليست stubs: OCR الموضعي، Character Studio، والفوترة الحية.

## 2. نطاق وطريقة الفحص

شمل الجرد 805 ملفات خارج `node_modules/dist/coverage/artifacts/.tmp`: 439 TypeScript، 76 TSX، 89 MJS، 41 SQL، 19 CSS، 47 Markdown، و48 JSON. توجد 353 ملفات TS/TSX إنتاجية و161 ملف اختبار و9 workflows.

تم الفحص بواسطة:

- قراءة المعمارية والعقود والمصادر والمسارات والعمال والمخازن والترحيلات والوثائق وملفات النشر.
- فحص exact clones والملفات الكبيرة والكود غير المستخدم والتبعيات والأنماط CSS.
- بناء كل workspaces، فحص حد الحزمة، `npm audit`، التغطية، العقود، الهجرة والنشر والـfixtures.
- اختبار متصفح فعلي للصفحات العامة والداخلية ومساحة PDF على سطح المكتب والهاتف.
- مطابقة النصوص التسويقية والأدوات والأيقونات مع العقود والتنفيذ الفعلي.

**حدود الاستنتاج:** لم تتوفر بيئة staging خارجية، حساب إدارة تشغيلي، Stripe live، مزود Character حقيقي، أو holdout OCR جديد. لذلك هذه عناصر «غير مثبتة» لا «فاشلة وظيفيًا» إلا حيث يوجد دليل مباشر.

### 2.1 تغطية المراجعة حسب المجلد

| النطاق | ما تمت مراجعته | الحكم المختصر |
|---|---|---|
| `apps/api/src` | auth، uploads، processing، exports، billing، character، admin، observability، storage، PostgreSQL | أساس قوي؛ أهم النواقص malware scan، بعض تغطية executors، وlegacy schema |
| `apps/web/src/app` | lifecycle، navigation، shell، error boundary، display preferences | عيب تبني المشروع ومراقبة أخطاء الويب وعنوان route |
| `apps/web/src/features` | كل المشاهد والأدوات والحوارات وhooks والعملاء | أعلى دين في Workspace والتغطية ونسخ الصيغ/RTL |
| `apps/web/src/styles` | 19 ملف CSS وترتيب layers/overrides/responsive | cascade debt وملفات ضخمة؛ يحتاج هجرة تدريجية |
| `apps/worker-*` | bootstrap/runtime/heartbeat/queues | boundaries واضحة؛ اختبارات runtime/failure أقل من المطلوب |
| `packages/contracts` | الحدود والصيغ والـcapabilities والـworkflow | مصدر حقيقة جيد؛ بقي aliases توافقية ونسخة UI لا تشتق منه دائمًا |
| `packages/document-processing` | PDF embedded text/OCR/layout/regions | تغطية جيدة نسبيًا؛ OCR release gate غير ناجح |
| `packages/export-adapters` | PSD/PNG/TIFF/character artifacts | تغطية قوية ومسارات فشل صريحة؛ legacy artifact fallback قائم |
| `packages/media-processing` | raster/alpha/edges | تغطية قوية؛ الملف الجامع كبير ويحتاج فصلًا عند التوسع |
| `packages/guidance` و`presets` | هندسة الإرشادات وسياسات التجهيز | تغطية جيدة، ولا dead exports مؤكدة |
| `apps/api/migrations` | 41 migration وتسلسل/توافق | لا تعدل التاريخ؛ خطط لإزالة العمود المزدوج فقط عبر contract migration |
| `scripts` | quality، bundle، deployment، recovery، load، release evidence | منظومة واسعة؛ المشغل الجامع غير مستقر على Windows وسياسة bundle تحتاج إعادة تعريف |
| `.github/workflows` و`deploy` وDocker/compose | 9 workflows، topology، metrics، alerts، hardening | ناضجة نسبيًا؛ يلزم إثبات staging على digests الفعلية وإضافة upload scanner |
| `docs` وملفات البيئة | readiness/runbooks/ADRs/examples | توثيق قوي، لكن `.env.example` يناقض بوابة OCR الموثقة |
| `assets/artifacts/e2e` | الأصول المرئية، fixtures، screenshots، Playwright | أدلة مفيدة؛ يجب ربط كل تقرير لاحقًا بـSHA وعدم خلط artifacts القديمة بمرشح جديد |

## 3. مصفوفة الحالة الحالية

| البوابة | الحالة | الدليل/التفسير |
|---|---:|---|
| بناء جميع workspaces | ناجح | `npm run build`؛ Vite حوّل 1685 module |
| حد الحزمة | ناجح بهامش خطر | JS ‏167.4/168 KiB، CSS ‏43.4/50 KiB gzip |
| ثغرات npm المعروفة | ناجح | `npm audit --audit-level=high`: صفر |
| الكود/التبعيات غير المستخدمة | ناجح | `npm run deadcode`/Knip بلا نتائج |
| exact clones | ناجح | لا كتلة مطابقة ≥16 سطرًا بحسب الفاحص |
| CSS lint | ناجح | `npm run lint:css` |
| التغطية | ناجحة مقابل حدود ضعيفة | API ‏67.71% statements؛ Web ‏45.15% statements |
| E2E | ناجح | 12/12 في آخر تشغيل على الحالة الحالية |
| بوابة الجودة الجامعة | غير مستقرة/حمراء | توقفت بـlibuv assertion على Windows؛ fixture نجح منفردًا |
| OCR corpus | حظر إصدار | 91 عينة/20 كتابًا؛ holdout v6 ‏27.02% مقابل هدف ≤25% والدليل stale |
| جاهزية staging/recovery/live providers | غير مثبتة | تحتاج بيئة وأسرارًا وأدلة خارج المستودع |

## 4. النتائج مرتبة حسب الأولوية

### P0 — حرج

لم أجد استغلالًا أمنيًا حرجًا مؤكدًا أو تلف بيانات دائمًا في النطاق المختبر. لا يعني ذلك إقرارًا أمنيًا؛ اختبارات الاختراق وبيئة staging خارج نطاق هذه اللقطة.

### P1 — مرتفع، يجب إغلاقه قبل مرشح الإصدار

#### P1-01 — مساحة العمل لا تتبنى المشروع داخل عنوان التطبيق

`App.tsx:287-304` يمرر `initialProject` إلى Workspace بلا callback لإرجاع المشروع الذي ينشئه Workspace. داخل `useWorkspaceProjectLifecycle.ts:151-163` يتم تحديث `projectId` محليًا فقط. و`entryState.ts:103-118` لا يستطيع كتابة المشروع إلا إذا عرفته طبقة التنقل العليا.

النتيجة المؤكدة: بعد إنشاء/رفع PDF يظل الرابط `?view=workspace&mode=book`، وإعادة التحميل تعرض مساحة فارغة بينما المشروع محفوظ. انظر [تقرير الاختبار الفعلي](./dogfood-2026-08-13-current/report.md#ux-001--مرتفع--فقد-سياق-المشروع-بعد-إعادة-التحميل).

**الإصلاح:** عقد `onProjectAdopted`، تحديث `workspaceProject`، ثم `replaceState` فور ثبوت المشروع/الإصدار. لا تستخدم `pushState` كي لا يضيف التاريخ مرحلة وسيطة فارغة.

**القبول:** E2E جديد يغطي create → upload → ready → reload → back/forward → resume، مع فشل الاختبار إذا غاب `projectId`.

#### P1-02 — لا يوجد فحص malware أو حجر قبل المعالجة

مسار الرفع يتحقق من الحجم، MIME/التوقيع، النوع، SHA، وسلامة التخزين، وهذه نقاط جيدة. لكن البحث في API والنشر لم يجد scanner أو quarantine state للمدخلات. مع ملفات يرفعها المستخدم، التحقق من النوع لا يساوي فحص محتوى خبيث، خصوصًا PDF والصيغ المركبة.

**الإصلاح الأدنى:** حالة `uploaded -> scanning -> clean|rejected|scan_failed`؛ لا يدخل المصدر طابور المعالجة قبل `clean`. شغّل `clamd`/خدمة فحص مُدارة عبر streaming، حدّد timeout وحجم الفحص، حدّث signatures، اخزن verdict وتوقيته وإصدار المحرك بلا نص المصدر، واحذف/اعزل المصاب. وثائق ClamAV تفرق بين `clamd` متعدد الخيوط و`clamscan` أحادي التشغيل وتوضح scanning والحجر: [ClamAV Usage](https://docs.clamav.net/manual/Usage)، [Scanning](https://docs.clamav.net/manual/Usage/Scanning.html?highlight=false+positive). أضف corpus آمنًا وEICAR في CI المعزول واختبارات الأنواع غير المتوقعة وفق [OWASP WSTG](https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/08-Test_Upload_of_Unexpected_File_Types).

**القبول:** لا يمكن إنشاء processing job قبل verdict clean؛ failure قابل لإعادة المحاولة ولا يفترض «نظيفًا»؛ metrics للزمن/الرفض/التعطل؛ runbook للحجر والحذف.

#### P1-03 — مسارات واجهة حرجة بلا تغطية كافية

حدود الويب الحالية في `apps/web/package.json:13` هي 26% statements و28% branches و19% functions و26% lines؛ وهي لا تصلح كحارس لتطبيق محرر. التقرير الحالي يعطي 45.15/41.39/35.73/46.81، لكن ملفات حرجة تظهر 0% unit coverage، منها `App.tsx` و`Workspace.tsx` و`WorkspaceEditorLayout.tsx` و`WorkspaceDialogs.tsx` ومحررات image/PDF وبعض hooks والعملاء. `LayerDock` نحو 22% و`WorkspaceChrome` نحو 20%.

API يحقق 67.71% statements و59.81% branches و69.5% functions و69.1% lines مقابل حدود 65/58/68/67 فقط. `processing-job-executor` وبعض runtimes وطبقة البدء/الهجرة لا تظهر تغطية وحدة؛ بعض مخازن PostgreSQL تُغطى في integration لكن مستثناة من تقرير الوحدة.

**الإصلاح:** حدود per-file لا إجمالي فقط: Workspace/lifecycle/upload/navigation ≥80% statements و≥70% branches أولًا، executors ≥85/75، auth/billing/upload ≥85/75. لا تُرفع الحدود العامة دفعة واحدة؛ أضف اختبارات السلوك المكتشف ثم ratchet كل حزمة.

**القبول:** اختبارات regression لـP1-01، فشل/إلغاء الرفع، تضارب autosave، retry/lease، وعدّادات الصفحة؛ لا ملف حرج جديد تحت الحد.

#### P1-04 — الإعداد المحلي يفعّل OCR فاشل البوابة افتراضيًا

`apps/api/src/config.ts:76-80` و`.env.production.example:65-68` وbaseline تجعل `PDF_REGION_OCR_ENABLED=false`. لكن `.env.example:37-40` تجعلها `true`، وREADME يطلب نسخ هذا الملف إلى `.env`. هذا يجعل بيئة التطوير العادية تعمل بسلوك تقول وثائق الجاهزية إنه يجب أن يبقى معطلًا لأن holdout فشل والدليل stale.

**الإصلاح:** اجعل `.env.example=false`، وأنشئ profile صريحًا مثل `.env.ocr-development.example` أو أمر `dev:ocr-experimental` مع banner دائم وfixture تحقق. لا تغيّر production gate.

**القبول:** التشغيل الافتراضي يعرض الأداة غير متاحة مع سبب عربي؛ لا تتفعل إلا بخيار تجريبي صريح؛ contract test يثبت ذلك.

### P2 — متوسط

#### P2-01 — لا توجد ملاحظة مركزية لأخطاء المتصفح

`AppErrorBoundary.tsx:27-42` يدعم `onError` ثم يحاول `globalThis.reportError`، لكن `main.tsx:7-12` لا يمرر adapter. يوجد fallback للمستخدم، لكن لا توجد issue مركزية، release، sourcemap، route/project/request correlation أو alert.

**الإصلاح:** إما endpoint داخلي صغير أولًا أو `@sentry/react` مع scrub صارم، release/commit، sourcemaps خاصة، sampling بلا session replay افتراضيًا، وربط request ID. Sentry توفر SDK رسميًا لـReact/Browser: [sentry-javascript](https://github.com/getsentry/sentry-javascript). يجب احتساب كلفته في الحزمة؛ SDK React الحالي ليس إضافة مجانية للحجم.

**القبول:** خطأ اصطناعي في staging يظهر باسم الإصدار وstack مفكوك وبدون اسم مشروع/ملف/نص PDF/PII، وينشئ alert وفق معدل لا وفق كل حدث.

#### P2-02 — سياسة حد الحزمة تمنع التطور السليم

`scripts/verify-bundle-budget.mjs:6-13` يجمع **كل** chunks، بما فيها lazy routes، تحت 168 KiB. الحالة الحالية 167.4 KiB، أي 0.6 KiB فقط. هذا لا يقيس تجربة التحميل الأولى وحدها ويعاقب التقسيم الكسول؛ كما أنه يدفع لاختصارات مثل aliases الأيقونات.

**الإصلاح:** ثلاثة budgets: initial public route، initial authenticated shell، وmax lazy chunk؛ مع total inventory ratchet منفصل لا يمنع إضافة feature lazy مبرر. احتفظ بحد chunk ‏64 KiB بعد قياس React vendor الحالي (~59.7 KiB). شغّل Lighthouse CI على build إنتاجي؛ الأداة تدعم تشغيل URLs على كل commit وإضافة assertions وتقارير: [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci/blob/main/docs/getting-started.md). وقِس LCP/INP/CLS ميدانيًا عند p75 بدل اعتبار المختبر إنتاجًا: [Core Web Vitals](https://web.dev/articles/vitals?hl=en).

#### P2-03 — أيقونات ذات دلالة غير مطابقة

`Icon.tsx:118-146` يعيد استخدام رموز مرئية غير مكافئة: `panelOpen` هو `PanelRightClose` مدوّر، `logout` هو `LogIn` مدوّر، `database` هو Server، `fileSearch` هو Search، `gauge` هو Activity، `smartphone` هو SquareDashed، و`wallet` هو CreditCard. هذا يخفض الحجم لكنه يربك الهوية البصرية والمعنى، خصوصًا الإدارة والأمان.

**الإصلاح:** استيرادات Lucide انتقائية حقيقية أو SVG داخلي صغير للأسماء المهمة، مع story/visual test واسم accessible من النص لا من الأيقونة. لا تضف مكتبة أيقونات ثانية.

#### P2-04 — ازدحام مساحة العمل وتعدد الأعمدة

`workspace.css:28-37` يبني ثلاثة أعمدة داخل shell ذي sidebar عام (`index.css:15-28`). تحت 1280 يطوى rail بصريًا لكن طبقة التطبيق العامة تبقى؛ والتحول للهاتف تحت 900 فقط (`workspace.css:729-771`). الأدلة المرئية عند 1024 و1440 تؤكد ضغط المعاينة واقتطاع التسميات.

**الإصلاح:** Workspace route full-bleed، auto-collapse حسب `ResizeObserver` لمساحة المحرر الفعلية لا viewport فقط، resizers للأدوات والطبقات، حفظ المقاسات، وأمر focus preview. لا تضف أعمدة جديدة قبل حل هذا.

#### P2-05 — عدّادات الطبقات تخلط النطاق

`LayerDock.tsx:331` يعرض `layers.length` الإجمالي في التبويب، ثم `:384` يعرض filtered/total مع قائمة scoped للصفحة. النتيجة الظاهرة 8 مقابل 4.

**الإصلاح:** `pageLayerCount / totalLayerCount` من selector واحد؛ أضف jump-to-page عند نتيجة بحث خارج الصفحة الحالية، وvirtualization فعلية عند مستندات النص الكبيرة بدل نافذة 32 اليدوية وحدها إذا أثبت profiling الحاجة.

#### P2-06 — نص صيغ التصدير لا يطابق العقد

`Dashboard.tsx:76-92` يعرض JPG/WEBP للصور وPDF للكتب. لكن `core-contracts.ts:119-136` يحدد image: PSD/PNG+JSON/layered TIFF/transparent PNGs، وbook: PSD/PNG+JSON/TXT/CSV/JSON. صفحة المساعدة والتسويق أقرب إلى الحقيقة، ما يخلق تناقضًا داخل المنتج.

**الإصلاح:** قاموس عرض واحد مشتق من contract، واختبار contract-copy يمنع ظهور صيغة غير مدعومة. إن كانت JPG/WEBP/PDF مطلوبة فعلًا فهي feature جديدة تحتاج builder/API/test، لا مجرد نص.

#### P2-07 — تراكم CSS دلالي وطبقات override

19 ملف CSS، 9561 سطرًا و290,108 بايت مصدر. `atelier.css` وحده 1554 سطرًا؛ ثم `export-review.css` 911 و`workspace.css` 871 و`account-admin.css` 691. `main.css` يحمل `atelier/luminous/accessibility` في طبقة overrides، والتعليقات نفسها تقول إن ملفات متأخرة تعيد تغطية legacy؛ `atelier.css:854` و`:1311` يعطلان قاعدة duplicate selector عمدًا. الفحص التقريبي وجد 366 مجموعة selector متكررة؛ بعضها media مقصود، لكن النمط العام دين cascade واضح.

**الإصلاح:** تجميد overrides الجديدة، ownership لكل feature، نقل route-by-route إلى CSS Modules أو طبقات feature بعقود data attributes، حذف القاعدة القديمة بعد visual diff، وتوثيق tokens. Playwright يدعم baseline screenshots و`toHaveScreenshot`: [Visual comparisons](https://playwright.dev/docs/test-snapshots)، وARIA snapshots للبنية: [ARIA snapshots](https://playwright.dev/docs/aria-snapshots). Storybook مفيد للمكونات المركبة والحالات، لكنه ليس إلزاميًا؛ اختبارات Playwright الحالية أقل كلفة كبداية: [Storybook visual tests](https://storybook.js.org/docs/8/writing-tests/visual-testing).

#### P2-08 — ملفات إنتاجية كبيرة رغم نجاح ratchet

هناك 37 ملفًا ≥400 سطر فعلي و65 ≥300. الأعلى: `auth-service.ts` 534، `ExportReview.tsx` 525، `ImageGuidanceEditor.tsx` 519، `upload-service.ts` 517، `processing-service.ts` 514، و`WorkspaceChrome.tsx` 504. فاحص maintainability يحسب الأسطر غير الفارغة؛ لذلك ينجح بعبارة «0 oversized» رغم أن المسؤوليات متكدسة.

**الإصلاح:** لا تقسيم شكلي. افصل حسب use-case: auth registration/session/password؛ upload validation/storage/finalization؛ Workspace chrome desktop/mobile/status؛ ExportReview state/preflight/download. لكل استخراج اختبار عقد ومالك. اجعل warning عند 350 source line وفشل عند 450 للملفات الجديدة بعد خفض تدريجي.

#### P2-09 — تكرار سلوك الأدوات بين سطح المكتب والهاتف

`WorkspaceToolRail.tsx:50-87` و`WorkspaceChrome.tsx:379-430` يبنيان زر الأداة وحالة التوفر والسبب والاختصار بطريقتين. registry مشتركة، لكن rendering/ARIA يمكن أن ينجرفا.

**الإصلاح:** `WorkspaceToolButton` و`WorkspaceToolGroup` مشتركان مع variant desktop/mobile؛ اختبار parameterized لكل tool availability وسبب التعطيل.

#### P2-10 — الرفع يحمّل الجسم كاملًا في ذاكرة API

`upload-routes.ts:104` يستخدم `parseAs: "buffer"` حتى 30 MiB، و`app.ts:72` يضع bodyLimit نفسه. السقف الحالي 30 MiB صحيح حسب طلب المنتج، لكن التزامن قد يضاعف ذاكرة Node قبل التخزين والمعالجة.

**الإصلاح:** لا تضغط PDF أثناء الرفع ولا تغير السقف. اختبر RSS عند N uploads متزامنة؛ إن كانت الشبكات غير مستقرة أو الذاكرة غير كافية، انتقل إلى streaming/direct-to-object-storage أو tus resumable مع checksum/expiration. بروتوكول tus يعرّف الاستئناف و`Tus-Max-Size`: [tus protocol](https://tus.io/protocols/resumable-upload)، وUppy يوفر عميل tus: [Uppy Tus](https://uppy.io/docs/tus/). لا تُدخل هذه البنية قبل إثبات الحاجة بقياس.

#### P2-11 — بوابة الجودة غير مستقرة على Windows

التشغيل الجامع اجتاز العقود والمعمارية والصيانة والنشر والاسترداد والـfixtures ثم توقف بـ`UV_HANDLE_CLOSING` assertion. تشغيل fixture نفسه منفردًا نجح. هذا يرجح تسريب handle/teardown أو خلل orchestrator، وليس فشل fixture وظيفيًا.

**الإصلاح:** سجل command/phase/handles، شغل كل مرحلة child process مستقلًا مع exit/timeout، لا تعِد استخدام workers بين Vitest وNode test، وأضف Windows CI أو اجعل Linux container بيئة الجودة الرسمية مع Windows smoke منفصل.

### P3 — منخفض/تحسين جودة

1. **عنوان الصفحة ثابت:** `index.html:47` فقط؛ أضف عنوانًا حسب view/project وإعلان route لقارئ الشاشة.
2. **RTL/LTR:** `PasswordRequirements.tsx:18` يحتاج `<bdi dir="ltr">10–128</bdi>`، ووحدات MiB/IDs/versions تحتاج مكوّنًا موحدًا.
3. **تعريب الأدوات:** `workspaceToolRegistry.ts:257` و`:338` يخلطان Character Turntable/Studio وأسبابًا إنجليزية؛ اختر مصطلحًا عربيًا مع الاسم التقني ثانويًا.
4. **Polling صامت:** `useCharacterStudioPolling.ts:48-54` يخفض الوتيرة عند الخطأ بلا حالة stale مرئية بعد النجاح الأول. أظهر «تعذر التحديث، آخر تحديث…» بعد حد زمني مع retry يدوي.
5. **خصوصية الرابط:** `entryState.ts:106-107` يضع `projectName` في URL. الاسم قد يظهر في history/logs/screenshots؛ اكتفِ بـ`projectId` واجلب الاسم من API.
6. **لوحة الإدارة غير dogfooded تشغيليًا:** ارفع E2E بحساب admin اصطناعي وبيانات jobs/audit/retention، مع منع أي production secret أو بيانات عميل.

### 4.1 الأخطاء الصامتة والسلوك المخفي

الفحص وجد 61 `catch {}` و23 Promise `.catch(...)` في كود الإنتاج، لكنه لم يجد `console.log/warn/error/debug` إنتاجيًا ولا TODO/FIXME/HACK/NotImplemented حقيقيًا. العدد وحده لا يعني 61 خطأ؛ التصنيف هو:

- **سليم ومقصود:** أخطاء `localStorage` تعود إلى default، فشل parser يتحول إلى domain error، وفشل observer لا يستبدل النتيجة الموثوقة. أمثلة: `useAppDisplayPreferences.ts:6-22`، `transport.ts:186-196`، `raster-asset-cleanup.ts:12-17`.
- **ظاهر للمستخدم لكنه فقير تشخيصيًا:** `useApplicationLifecycle.ts:69-75` و`SettingsView.tsx:77-100` يعرضان رسالة عامة ولا يرفقان request ID؛ أضف correlation ID عندما يأتي من API ولا تعرض التفاصيل الحساسة.
- **صامت فعليًا ويحتاج إصلاحًا:** `useCharacterStudioPolling.ts:48-54` يحول الخطأ إلى backoff بلا stale/error state؛ قد يظل المستخدم يرى بيانات قديمة كأنها حديثة.
- **صمت ملاحظة مركزي:** `AppErrorBoundary` يحمي الصفحة لكن adapter غير موصول، لذا الاستثناء الذي لا يبلغ API قد لا يصل إلى المشغل.
- **مقصود في cleanup/telemetry فقط:** عدة catches في upload/export/worker تحمي النتيجة الموثوقة من فشل sink. يجب إبقاؤها، لكن اختبر أن callback الأساسي نفسه يكتب metric مستقلًا ولا يصبح no-op دائمًا.

قاعدة الإصلاح المقترحة: كل catch يختار واحدًا صريحًا من `recover + state` أو `translate + throw` أو `observe + preserve authoritative outcome`. امنع bare catch جديدًا بـESLint إلا مع تعليق سبب واختبار مسار الفشل.

## 5. الكود القديم والتوافق التاريخي

| الموضع | الدين القديم | القرار |
|---|---|---|
| `workflow-contracts.ts:70-71` | `requestId` alias deprecated لـ`idempotencyKey` | أبقه مؤقتًا مع telemetry وعدّاد مستهلكين؛ احذفه في نافذة contract موثقة |
| `export-artifact-reader.ts:14-35` | fallback لمفتاح artifact قديم عند غياب `objectKey` | backfill للصفوف القديمة، قياس الاستخدام، ثم حذف fallback بعد نافذتي إصدار/rollback |
| `idempotency-store.ts:77-94` | سجلات بلا `requestHash` تعامل legacy | لا تحذف قبل انتهاء TTL/ترحيل durable store؛ أضف metric legacy replay |
| `migrate.ts:39-49` | إصلاح اسم ترحيل تاريخي 004→017 | أبقه ما دامت قواعد قديمة مدعومة؛ وثّق تاريخ نهاية الدعم |
| `009_source_versions.sql:81-120` و`019_upload_url_compatibility.sql` | عمودا `demo_upload_url` و`upload_url` + trigger مزامنة | نفّذ backfill وtelemetry ثم contract migration مستقلة؛ لا تعدل migration مطبقًا |
| `postgres-upload-record.ts:25-40` و`postgres-upload-repository.ts:137-145` | `COALESCE` وكتابة مزدوجة | يزالان فقط بعد إثبات صفر قراءات للعمود القديم |

هذه ليست «ملفات يجب حذفها الآن». الإزالة الصحيحة Expand → Backfill → Observe → Contract مع ADR وrollback، وإلا قد تكسر قواعد بيانات رُقيت من نسخ قديمة.

## 6. الأدوات والوظائف: مكتمل، مقيد، أو ناقص

| الأداة/الوظيفة | التصنيف | الملاحظة والقرار |
|---|---|---|
| رفع صورة/PDF حتى 30 MiB | مكتمل أساسيًا | لا ترفع السقف؛ أضف malware scan واختبار ذاكرة/تزامن |
| فصل الصور/الطبقات والتوجيه | مكتمل مع دين اختبار/UX | أصلح ازدحام المحرر وارفع التغطية |
| PDF embedded text | مكتمل أساسيًا | حافظ على الخلفية الثابتة واختبارات الصفحات الكبيرة |
| OCR الموضعي للمنطقة | مقيد وغير جاهز للإصدار | يبقى disabled حتى sealed holdout جديد ≤25% CER؛ أصلح `.env.example` |
| Character Turntable/Studio | مقيد خارجيًا | يبقى disabled حتى provider/golden/legal/canary/egress/cleanup؛ عرّب الاسم |
| PSD/PNG+JSON/TIFF/text exports | منفذ | صحح نص لوحة التحكم، وأبق preflight/generation immutable |
| الفوترة sandbox | مكتملة للتطوير | لا تعدّ live جاهزة قبل webhook replay/idempotency/reconciliation وstaging |
| الفوترة live/Stripe | منفذة خلف gate لكن غير مثبتة | اختبار provider حقيقي وrunbook refund/cancel/portal قبل التفعيل |
| الإدارة | منفذة جزئيًا ومغطاة جزئيًا | تحتاج E2E تشغيليًا مع RBAC/audit وبيانات jobs |
| سجل الإصدارات والاستعادة | منفذ | أضف استئناف الرابط واختبارات source restore من UI |
| البحث/التصفية/إجراءات الطبقات | منفذ | وضّح page/total وفكر في virtualization بعد profiling |
| مراقبة أخطاء API | جيدة نسبيًا | OpenTelemetry/metrics/alerts موجودة؛ تحقق من staging |
| مراقبة أخطاء الويب | ناقصة | أوصل ErrorBoundary بجامع مركزي مع scrub/release |
| فحص malware للرفع | غير موجود | أولوية P1 قبل جمهور عام |

**قرار الحذف:** لا تحذف أداة منتج الآن. أضف telemetry استخدام محلي يحترم الخصوصية لمدة إصدارين؛ الأداة التي لا تُستخدم ولا تملك مالكًا أو نتيجة منتج قابلة للقياس يمكن بعدها حذفها عبر ADR. `knip` لا يثبت عدم قيمة feature، لكنه يثبت عدم وجود dead dependency/export واضح حاليًا.

## 7. مراجعة الصفحات والقوائم

| الصفحة | الحالة | أهم التحسينات |
|---|---|---|
| Landing | جيدة بصريًا | قياس ميداني، عنوان route، مراجعة الادعاءات مقابل features المفعلة |
| Dashboard | جيدة الهيكل | صحح صيغ التصدير وBidi للوحدات؛ لا تعرض أدوات gated كقدرة عامة بلا وسم |
| Projects | حالة الفراغ جيدة | أضف resume واضح وآخر إصدار/حالة فشل، واختبار المشروع المتبنى بعد reload |
| Exports | حالة الفراغ جيدة | أضف filter/status/retry وسبب انتهاء الرابط؛ اربط بالمشروع |
| Billing | responsive | وحّد Sandbox/Live copy، لا تعرض provider غير متاح، وأضف reconciliation status |
| Settings | جيدة على الهاتف | اجعل reset layout قابلًا للتراجع، وبيّن نطاق تصدير/حذف البيانات |
| Security | جيدة وظيفيًا | أصلح 10–128 RTL، أضف active session revoke feedback واختبارات rate-limit |
| Help | مختصرة ومفيدة | اجعل الصيغ/الحدود مشتقة من capability contract، وأضف troubleshooting حسب error code |
| Admin | غير مثبتة فعليًا | E2E admin، pagination/filters، correlation links، حماية PII |
| Workspace | أعلى مخاطرة UX | تبني الرابط، full-bleed، عدادات page/total، resizable columns، visual/a11y regression |
| القوائم العامة | سليمة إجمالًا | route title/focus، إخفاء sidebar في Workspace، حفظ drawer state بحذر |

## 8. أدوات مهنية مقترحة — بأقل كلفة لازمة

1. **Playwright visual + ARIA snapshots (أولوية فورية):** موجود أصلًا، فلا تضف منصة جديدة أولًا. ثبّت baselines للـLanding/Dashboard/Workspace/LayerDock/Auth عند 375/1024/1440 وlight/dark/RTL.
2. **axe-core عبر Playwright (فوري):** بوابة critical/serious لكل route والحوار والـmobile sheets، مع allowlist مؤقت بمالك وتاريخ إزالة.
3. **Browser error monitoring (فوري):** endpoint داخلي أو Sentry React. ابدأ errors/releases فقط؛ لا session replay قبل مراجعة الخصوصية، لأن التطبيق يعالج صورًا وPDF وأسماء مشاريع.
4. **ClamAV أو خدمة malware scan مُدارة (قبل الجمهور العام):** scan-before-process، quarantine، signature freshness، SLO وfail-closed.
5. **Lighthouse CI + `web-vitals` RUM (بعد استقرار P1):** lab gate للانحدار وقياس ميداني p75. لا ترسل URLs أو أسماء مشروعات.
6. **Storybook اختياري، لا فوري:** أضفه فقط إذا استمر نمو primitives/dialogs/tool states؛ Playwright route/component harness يكفي الآن لتقليل عبء الصيانة.
7. **tus/Uppy اختياري مبني على القياس:** السقف 30 MiB لا يبرر وحده بنية resumable. استخدمها إذا أثبتت بيانات الفشل/الشبكات/الذاكرة الحاجة.
8. **Feature flags مع kill switches موجودة أصلًا:** حسّن ownership/expiry/audit بدل إضافة منصة flags جديدة الآن.

## 9. خطة التنفيذ المتسلسلة

### المرحلة 0 — تثبيت المرشح وقابلية التتبع (0.5–1 يوم)

- افصل التغييرات الـ71 إلى commits موضوعية؛ لا تخلط إصلاحات المنتج بالتقارير/الأدلة.
- أعد `quality` في بيئة Linux الرسمية وWindows smoke، وسجل المرحلة التي تسرب handles.
- ثبّت تقرير build/bundle/audit/coverage/E2E على SHA واحد.

**القبول:** worktree نظيف، SHA محدد، كل artifact يحمل SHA والوقت والبيئة، وquality خضراء مرتين متتاليتين.

### المرحلة 1 — منع فقد السياق وتصحيح عقود الواجهة (1–2 يوم)

- نفذ `onProjectAdopted` وربط URL، واحذف `projectName` من query.
- صحح صيغ Dashboard من contract، وعدّادات page/total، وعناوين الصفحات وBidi.
- أضف اختبارات regression/E2E وARIA لهذه الحالات.

**القبول:** create/upload/reload يستعيد المشروع؛ لا صيغة معروضة غير مدعومة؛ العدادات صحيحة في PDF متعدد الصفحات؛ route title صحيح.

### المرحلة 2 — أمن الرفع والملاحظة (3–5 أيام)

- صمم upload scan state machine وadapter؛ شغل scanner في compose integration/staging.
- أوصل ErrorBoundary بجامع آمن، وأضف release/source maps وscrub.
- load test لـ30 MiB عند تزامن متفق عليه، وقِس RSS/latency/queue.

**القبول:** EICAR مرفوض ومحجور، scan failure لا يعالج الملف، لا PII في events، والتنبيهات/runbooks مجربة.

### المرحلة 3 — Workspace وتجربة المحرر (4–7 أيام)

- full-bleed route، auto-collapse/resizable rails، focus preview.
- استخرج مكونات أدوات مشتركة وأصلح الأيقونات الدلالية.
- visual/ARIA baselines عند 375/768/1024/1280/1440 وlight/dark.

**القبول:** لا اقتطاع لإجراء أساسي، لا overflow، لوحة المفاتيح تكمل كل المسار، وvisual diff مراجع.

### المرحلة 4 — تغطية وقابلية صيانة (5–8 أيام بالتدريج)

- اختبارات per-file للـWorkspace/executors/auth/upload/billing.
- تفكيك الملفات الأعلى مخاطرة حسب use-case.
- هجرة CSS route-by-route وإزالة overrides بعد إثبات بصري.
- إعادة تعريف budgets حسب رحلة التحميل لا مجموع كل lazy chunks.

**القبول:** الحدود الحرجة ≥80/70، لا source file جديد >450 سطرًا، لا override غير مملوك، initial route budgets خضراء.

### المرحلة 5 — بوابات الأدوات المقيدة وstaging (تعتمد على خارج المستودع)

- OCR: sealed holdout جديد لم يُستخدم في التطوير، CER ≤25%، مراجعة عربية بشرية، canary وkill switch.
- Character: provider خاص، egress allowlist، golden Adobe، حقوق/خصوصية، retries/leases/cleanup، canary.
- Billing live: Stripe staging/live webhooks، replay/idempotency/reconciliation/refund/cancel/portal.
- نفذ recovery/fault/rollback/topology على نفس digests المرشحة.

**القبول:** أدلة موقعة مرتبطة بالـSHA، موافقة مالك لكل gate، rollback مجرب، ولا يُفعّل feature عند فشل dependency.

## 10. Backlog مرتب جاهز للتنفيذ

| الترتيب | المهمة | الأولوية | تقدير | المالك المقترح |
|---:|---|---:|---:|---|
| 1 | Adopt project into URL + reload regression | P1 | 1–2 يوم | Web |
| 2 | تعطيل OCR التجريبي في `.env.example` | P1 | 0.5 يوم | Platform/API |
| 3 | Malware scan state/adapter/quarantine | P1 | 3–5 أيام | Security/API |
| 4 | Critical web/API per-file coverage | P1 | 3–6 أيام | Web/API/QA |
| 5 | Browser error collection + scrub/release | P2 | 1–3 أيام | Web/Platform |
| 6 | Contract-driven export copy + Bidi/title | P2/P3 | 1 يوم | Web/Product |
| 7 | Workspace full-bleed/responsive columns | P2 | 3–5 أيام | Web/Design |
| 8 | Page/total layer counts + search navigation | P2 | 1–2 يوم | Web |
| 9 | Semantic icons/shared tool button | P2 | 1–2 يوم | Web/Design |
| 10 | Bundle budget redesign + Lighthouse | P2 | 1–2 يوم | Web/Platform |
| 11 | CSS ownership/migration | P2 | 5–10 أيام تدريجيًا | Web |
| 12 | Legacy compatibility telemetry/removal ADR | P2 | 2–4 أيام + نافذة إصدار | API/Data |

## 11. تعريف الجاهزية النهائي

لا تعتبر النسخة جاهزة إلا إذا تحققت الشروط التالية معًا:

- لا P1 مفتوح، وعيب reload مغطى E2E.
- quality/build/typecheck/lint/deadcode/audit/coverage/E2E/visual/a11y خضراء على SHA واحد.
- فحص malware fail-closed قبل المعالجة، ومراقبة أخطاء الويب مرتبطة بإصدار ومنزوعة PII.
- حدود الويب الحرجة per-file لا الإجمالي الهزيل فقط.
- الأداء يقاس في build إنتاجي، ثم ميدانيًا عند p75؛ لا اعتماد على localhost.
- OCR/Character/Billing live تبقى معطلة حتى أدلتها المستقلة.
- staging وrecovery وrollback تعمل على digests نفسها، مع مالك وتنبيه وrunbook وkill switch.
- worktree نظيف، migration compatibility موثقة، ولا حذف legacy قبل backfill/observe/contract.

## 12. القرار النهائي

**أفضل خطوة تالية ليست إضافة مزيد من الأدوات المرئية.** ابدأ بمنع فقد سياق المشروع، إغلاق أمن الرفع، وتوصيل مراقبة الويب؛ ثم بسّط Workspace وCSS وارفع تغطية المسارات الحرجة. بعد ذلك فقط قيّم إضافة وظائف جديدة. المنتج يملك أساسًا قويًا، لكن تحسين الثقة والاستئناف والملاحظة سيعطي المستخدم قيمة أكبر من توسيع قائمة أدوات غير مثبتة.
