# تقرير المراجعة النهائية الشاملة للكود وخطة الإصلاح المتتابعة — MotionPrep Studio

**تاريخ المراجعة:** 2026-08-01
**المستودع:** `ahmed1122-rpg/riig-`
**الفرع المفحوص:** `main`
**بصمة HEAD المحلية والبعيدة:** `45f8e64be808f857de90b6be826fdf960a90d234`
**حالة القرار:** الكود المحلي صالح للمراجعة وCI، لكنه **غير صالح للنشر العام حاليًا** قبل إغلاق بوابات الإصدار الموضحة في هذا التقرير.

---

## 1. الخلاصة التنفيذية

البناء ليس مشروعًا ناقص الهيكل أو مجموعة صفحات تجريبية؛ إنه تطبيق ويب إنتاجي متكامل نسبيًا مبني كـ modular monolith، ويضم واجهة React، وواجهة API، وPostgreSQL، وRedis، وتخزين S3، وثلاثة عمال للمعالجة والمستندات والتصدير، ومسارات فوترة وبريد وأمان واسترداد. اجتاز البناء المحلي الشامل، وفحوص TypeScript وESLint وKnip، واختبارات API والحزم، وطوبولوجيا Docker متعددة النسخ، وتدفق المتصفح الكامل.

مع ذلك، توجد فجوة مهمة بين عبارة «فحوص الجودة ناجحة» وبين مستوى الثقة الحقيقي في الإصدار:

1. **الحالة المحلية غير قابلة للإصدار بعد:** توجد 95 خانة تغيير في working tree، منها 56 ملفًا متتبعًا معدلًا و39 ملفًا غير متتبع، بينما `origin/main` ما زال عند نفس HEAD القديم. أي أن الإصلاحات الحالية لم تُدمج ولم تحصل على دليل CI بعيد لنفس المحتوى.
2. **بوابة التغطية الاختبارية مضللة جزئيًا:** التقرير المعتاد يعرض تغطية ملفات مستوردة/مختارة، بينما القياس الشامل أعطى للواجهة 16.67% statements فقط، ولـ API نسبة 64.95% statements. صفحات ومسارات إنتاجية كبيرة ما زالت صفرية التغطية الوحدية.
3. **يوجد تذبذب E2E حقيقي:** فشل مسار الهاتف الكامل مرة بصفحة بيضاء، ثم نجح منفردًا، ثم نجحت المجموعة الكاملة 6/6. هذا ليس مسارًا مكسورًا دائمًا، لكنه خلل استقرار وتشخيص يجب علاجه قبل الاعتماد على نتيجة وحيدة.
4. **تأكيد الدفع في الواجهة غير موثوق دلاليًا:** العودة بمعامل `payment` غير `cancelled` تُظهر النجاح بعد تحديث عام، من دون التحقق من أن جلسة الدفع المحددة أصبحت مدفوعة أو أن الاشتراك تغير فعليًا.
5. **آخر تعديل قد يضيع عند المغادرة السريعة:** الحفظ التلقائي ينتظر 700ms ثم يحفظ، لكنه يلغي المؤقت عند unmount ولا يضمن flush أو تحذيرًا قبل مغادرة الصفحة.
6. **OCR الإقليمي غير جاهز، لكنه معطل بطريقة صحيحة:** الدليل الحالي قديم وCER التاريخي 27.02% أعلى من الهدف 25%، لذلك الأداة مغلقة من الخادم والواجهة. معالجة PDF العادية وتحريره وتصديره لا تتوقف على هذه الميزة.
7. **لا توجد حاليًا ملفات أو imports أو روابط توثيق محلية مكسورة مؤكدة، ولا توجد قائمة كود ميت آمنة للحذف:** Knip وESLint وTypeScript والبناء وفحص روابط Markdown نجحت جميعًا. ما يوجد هو تكرار مؤكد محدود، وتكرار شكلي يحتاج توحيدًا انتقائيًا، وملفات ضخمة ودين CSS ينبغي تفكيكهما باختبارات توصيفية.

**التوصية:** لا تبدأ بحذف واسع أو إعادة هيكلة شاملة. ابدأ بتثبيت خط الأساس، ثم أصلح صدق الدفع والحفظ واستقرار E2E والتغطية، ثم وحّد التكرارات المؤكدة، ثم نفّذ إعادة الهيكلة، وبعدها فقط نفّذ بوابات staging والإصدار الموقّع.

---

## 2. نطاق المراجعة وطريقتها

شملت المراجعة جميع مجموعات الملفات التنفيذية والاختبارية والتشغيلية ذات الصلة، وليس الملفات المعدلة فقط:

- `apps/api`: المسارات والخدمات والمستودعات والبنية التحتية والعمال والهجرات.
- `apps/web`: الدخول، التسويق، لوحة التحكم، مساحة العمل، الفوترة، العملاء، CSS وتجربة الهاتف.
- `packages/*`: العقود، معالجة المستندات، معالجة الوسائط، الإرشاد، الإعدادات المسبقة ومحولات التصدير.
- `workers/*`: نقاط تشغيل عمال الوسائط والمستندات والتصدير.
- `scripts/*`: التحقق من البيئة، OCR، الاسترداد، صحة العمال، الصور المرئية والحزم.
- `deploy/*` وDocker وGitHub Actions وملفات البيئة والتوثيق وADRs.
- الأصول والـ fixtures، بما فيها ملفات PDF المحلية.

### 2.1 حجم السطح المفحوص

| المؤشر | النتيجة |
|---|---:|
| الملفات ذات الصلة بعد استبعاد `node_modules/dist/coverage/artifacts` غير المقصودة | 444 ملفًا |
| TypeScript | 221 |
| TSX | 42 |
| JSON | 39 |
| MJS | 34 |
| Markdown | 30 |
| SQL migrations | 27 |
| CSS | 15 ملفًا / نحو 7,855 سطرًا |
| ملفات المصدر/الاختبار/السكربتات المحسوبة | 295 |
| أسطر TS/TSX/MJS التقريبية | 49,736 |

### 2.2 أدوات الإثبات

- جرد Git، والفرق الحالي، ونهايات الأسطر، والملفات المولدة والمتجاهلة.
- `npm run quality` بكامل بواباته.
- TypeScript وESLint وKnip والبناء وميزانية الحزمة.
- اختبارات الوحدة والتكامل لكل workspace.
- قياس تغطية إضافي باستخدام include glob يشمل كل ملفات `src`، وليس الملفات المستوردة فقط.
- `npm run test:topology:full` في Docker من مساحة مؤقتة نظيفة.
- Playwright لسطح المكتب والهاتف، مع إعادة مسار الفشل ثم إعادة المجموعة كاملة.
- `npm audit --json`، وفحص أنماط الأسرار، وقراءة إعدادات HTTP وDocker وCI.
- فحص جميع روابط Markdown المحلية، وتسلسل الهجرات، ومسارات imports والبناء.
- مسح أسماء الدوال المتكررة ثم مراجعة دلالية للحالات عالية القيمة؛ تكرار الاسم وحده لم يُعامل كدليل على كود مكرر.

### 2.3 حدود التقرير

- لم تُستخدم حسابات مزودي cloud أو Stripe live أو Adobe مرخصة؛ لذلك لا يدعي التقرير نجاح staging الخارجي أو Adobe Golden.
- لم يُستعلم عن سجل GitHub Actions البعيد لأن GitHub CLI غير متاح محليًا، كما أن المحتوى الحالي غير مدفوع أصلًا إلى remote.
- الملفات الثنائية فُحصت من حيث الجرد والحجم والاستخدام، لا من حيث تحليل كل بكسل.
- لم يُحذف أي كود أثناء إعداد التقرير.

---

## 3. نتائج التحقق القابلة لإعادة الإنتاج

| البوابة | النتيجة | الملاحظة |
|---|---|---|
| `npm run quality` | ناجح | استغرق نحو 147.7 ثانية |
| API | 178/178 ناجح | 45 ملف اختبار |
| Document processing | 38/38 ناجح | العقود الأساسية سليمة |
| Web unit/component | 73/73 ناجح | لا يعكس كل ملفات الواجهة كما سيأتي |
| TypeScript | ناجح | لا imports مكسورة |
| ESLint | ناجح | لا متغيرات/قواعد فاشلة |
| Knip | ناجح | لا ملفات أو exports أو dependencies ميتة مثبتة |
| Build | ناجح | حزمة الإنتاج تُبنى |
| ميزانية الويب | ناجحة | JS gzip 142.1 KiB، CSS gzip 36.8 KiB |
| Docker topology | ناجح | نسختا API، PostgreSQL، Redis، MinIO/S3، Mailpit والعمال |
| E2E — المحاولة الأولى | 5/6 ثم فشل واحد | صفحة بيضاء في مسار الهاتف الكامل |
| E2E — إعادة الاختبار المتأثر | 1/1 ناجح | لم يعد الفشل منفردًا |
| E2E — إعادة المجموعة كاملة | 6/6 ناجح | 47.6 ثانية |
| `npm audit --json` | 0 ثغرات معروفة | 497 dependency إجمالًا |
| `git diff --check` | ناجح | لا whitespace errors أو conflict markers |
| روابط Markdown المحلية | 0 روابط مكسورة | 57 ملف Markdown ضمن الفحص الموسع |
| migrations | 001–027 بلا فجوات | التحقق والتشغيل المتزامن ناجحان |
| PDF fixtures | ملفان / 48,178 bytes | تغطية تنوع PDF ما زالت ضعيفة |

---

## 4. الإصلاحات الموجودة حاليًا والمتحقق منها

هذه الإصلاحات موجودة في working tree الحالي واجتازت الفحوص المحلية، لكنها لم تصبح جزءًا من `origin/main` بعد:

1. **النشر الذري لرفع الملفات:** إضافة أمر finalization داخل معاملة PostgreSQL واحدة، مع أقفال صفوف وإعادة تشغيل idempotent ومصالحة للحالات المنقطعة.
2. **مصالحة الرفع:** `UploadReconciler` يعيد فحص النوع والحجم والبصمة قبل تحويل المصدر إلى ready، بدل ترك حالات `verifying` أو حالات متناقضة.
3. **كاش أصول آمن:** ربط أصل الطبقة ببصمة SHA-256، والتحقق من البصمة، وإرجاع `ETag/304`، وقصر `immutable` على العنوان المشتمل على البصمة.
4. **عقد capabilities مركزي:** حدود الرفع وPDF وعدد طبقات الصور وحالة OCR الإقليمي تصدر من الخادم وتستهلكها الواجهة بفشل مغلق.
5. **Rate limiting موزع:** استخدام Redis في الإنتاج بدل ذاكرة كل نسخة API منفصلة، مع اختبارات للمخزن.
6. **بريد أمني دائم:** migration رقم 027، وemail outbox ذري، ومحاولات مؤجلة محدودة، وتنظيف للبيانات الحساسة، واختبارات SMTP/outbox.
7. **OpenAPI وأمان HTTP:** افتراضات موحدة للأخطاء والأمان، واختبارات للعقد، وإخفاء المسارات الداخلية، وسياسة `no-store` لمسارات API الحساسة.
8. **استرداد React:** إضافة `AppErrorBoundary` بدل ترك شاشة ميتة عند انهيار مكون.
9. **تعارض مراجعة المستند:** معالجة revision conflict وإتاحة تحميل النسخة الأحدث بعد تأكيد المستخدم بدل الكتابة الصامتة فوقها.
10. **تقسيم أجزاء من الملفات الضخمة:** فصل رسم raster للتصدير، وعمليات نص PDF، وأخطاء المعالجة، وأداة تشغيل inline، ووحدات finalization/reconciliation.
11. **تحسينات العمال:** drain واختبارات صحة عامل، وتأخيرات polling عشوائية لتقليل بدء جميع النسخ في اللحظة نفسها.
12. **توثيق قرارات التشغيل:** ADRs للكاش ومصدر الحقيقة، الرفع الذري، البريد الدائم، واعتماديات الإنتاج وTLS.

هذه القائمة لا تعني اكتمال الإصدار؛ بل تعني أن التنفيذ المحلي لهذه البنود له دليل اختبار، ويحتاج الآن إلى مراجعة وcommit وCI على SHA ثابت.

---

## 5. سجل الأخطاء والمخاطر حسب الأولوية

### 5.1 P0 — موانع إصدار إجرائية

#### P0-01: الإصلاحات غير مثبتة في Git ولا توجد في remote

**الدليل:**

- 95 مدخلًا في `git status`.
- 56 ملفًا متتبعًا معدلًا و39 ملفًا غير متتبع.
- الفرق المتتبع وحده: 1,568 إضافة و843 حذفًا.
- HEAD المحلي و`origin/main` كلاهما عند `45f8e64...`؛ إذًا محتوى working tree ليس جزءًا من هذه البصمة.

**الأثر:** لا يمكن بناء صورة إنتاج قابلة للتتبع من الإصلاحات الحالية، ولا يمكن نسبة نتائج CI أو توقيع صورة إلى المحتوى الجاري مراجعته.

**الإصلاح:** تثبيت خط أساس، مراجعة الأسرار والمخرجات، تقسيم التغييرات إلى commits موضوعية، فتح PR، ثم اعتماد SHA مدمج واحد لكل بوابات الإصدار.

**معيار القبول:** working tree نظيف، CI أخضر على SHA المدمج، وصور runtime/web مبنية وموقعة من SHA نفسه.

> لا توجد ثغرة كود P0 مؤكدة في الفحص الحالي؛ P0 هنا هو سلامة عملية الإصدار والتتبع.

### 5.2 P1 — أخطاء أو فجوات ثقة يجب إغلاقها قبل الإنتاج

#### P1-01: بوابة التغطية الحالية لا تقيس كل كود الإنتاج

**المشكلة:** أوامر التغطية المعتادة تقيس الملفات المستوردة أو مجموعة مختارة. لذلك يمكن للبوابة أن تنجح بينما صفحات وخدمات كاملة لا تدخل المقام أصلًا.

**القياس الشامل للواجهة:**

- Statements: 16.67% — 511/3064.
- Branches: 22.14% — 622/2809.
- Functions: 13.03% — 121/928.
- Lines: 17.10% — 466/2725.

**ملفات حرجة وصلت إلى 0% وحديًا:** `App.tsx`، `AppErrorBoundary.tsx`، `BillingPortal.tsx`، `Dashboard.tsx`، `LandingPage.tsx`، `Workspace.tsx`، معظم المحررات والحوارات، `useWorkspaceReviewAutosave.ts`، `workspaceDocument.ts`، وعدد كبير من عملاء API.

**القياس الشامل لـ API:**

- Statements: 64.95% — 2764/4255.
- Branches: 58.30% — 1649/2828.
- Functions: 67.28% — 654/972.
- Lines: 66.56% — 2662/3999.

**فجوات API:** نقاط تركيب وتشغيل وبنية تحتية كثيرة لا تدخل تغطية الوحدة، مثل `server.ts` وأجزاء من worker runtimes والمهاجر والمستودعات/outbox. بعض هذه المسارات له تكامل Docker، لكن البوابة الحالية لا تفصح عن ذلك بوضوح.

**الإصلاح:** إضافة `coverage.include=src/**/*.{ts,tsx}` لكل workspace، واستثناء entrypoints المبررة فقط، ونشر تقريرين: unit coverage وintegration/E2E coverage. ابدأ بحد أدنى واقعي يرتفع تدريجيًا، لا برقم مرتفع يؤدي إلى استثناءات صامتة.

**معيار القبول:** لا يوجد ملف إنتاج خارج المقام دون استثناء موثق، وكل مسار مالي/رفع/تصدير/تعارض/حفظ له اختبار سلوك.

#### P1-02: اختبار E2E للهاتف متذبذب وصفحته البيضاء غير مشخصة

**الدليل:** فشل الاختبار `e2e/motionprep.spec.ts:63` مرة عند انتظار «فتح الاستوديو كضيف»؛ صورة الفشل كانت بيضاء ولم يصل طلب API للاختبار المتأثر. نجح الاختبار منفردًا، ثم نجحت المجموعة كاملة 6/6.

**الترجيح:** سباق في إقلاع Vite/React أو إعادة تشغيل خادم `node --watch` أو تحميل صفحة قبل الاستعداد، وليس عطل endpoint ثابتًا.

**الإصلاح:**

- إيقاف `--watch` في خادم E2E واستخدام start ثابت بعد build أو `tsx src/server.ts` بلا watcher.
- إضافة capture لـ `pageerror` و`console.error` و`requestfailed` وtrace عند أول retry.
- بعد `page.goto`، انتظار علامة readiness دلالية لا مجرد `domcontentloaded`.
- تشغيل المسار الحرج 10–20 مرة على الهاتف وسطح المكتب في CI stress job.
- محاذاة إصدارات Playwright كما في P2-06.

**معيار القبول:** 20 تشغيلًا متتاليًا بلا صفحة بيضاء، وأي فشل لاحق يرفق trace وconsole والشبكة تلقائيًا.

#### P1-03: الواجهة تؤكد نجاح الدفع من query string لا من حقيقة الخادم

**الموقع:** `apps/web/src/features/billing/BillingPortal.tsx:139`.

**السلوك الحالي:** بعد الرجوع، تنفذ الواجهة `refreshBilling()` ثم تضبط الحالة إلى success لكل قيمة `payment` ليست `cancelled`. يمكن فتح `?payment=success&billingReturn=1` يدويًا، أو قد يتأخر webhook، فتظهر رسالة نجاح قبل تغير الاشتراك.

**الأثر:** لا يحدث منح صلاحيات من الواجهة وحدها، لذلك ليست ثغرة مالية مباشرة، لكنها رسالة مالية غير صادقة وتجربة مستخدم خطرة.

**الإصلاح:** إضافة endpoint يتحقق من checkout session المملوكة للمستخدم، أو polling محدود لحالة الجلسة/الاشتراك حتى `paid/active` بعد webhook. لا تُعرض success إلا من حالة خادم موثوقة؛ عند التأخر اعرض «جارٍ التحقق» مع إمكانية إعادة المحاولة.

**معيار القبول:** تغيير query يدويًا لا يعرض النجاح، وتأخر webhook لا ينتج فشلًا كاذبًا أو نجاحًا كاذبًا، واختبارات success/cancelled/expired/foreign-session/delayed-webhook ناجحة.

#### P1-04: احتمال فقد آخر تعديل عند مغادرة مساحة العمل قبل الحفظ

**الموقع:** `apps/web/src/features/workspace/useWorkspaceReviewAutosave.ts:164`.

**السلوك:** التعديل يُجدول بعد 700ms. cleanup يلغي المؤقت فقط. التصدير يستدعي flush، لكن unmount أو إغلاق التبويب أو انتقال سريع قد يلغي التعديل غير المرسل.

**الإصلاح:**

- اجعل التنقل داخل التطبيق ينتظر `flushLayerReview()` أو يعرض حوار بقاء/مغادرة.
- أضف `beforeunload` عندما توجد تغييرات غير محفوظة؛ لا تعتمد على طلب async أثناء unload.
- خزّن draft محليًا بمفتاح project/source/revision إن كانت خسارة التعديل غير مقبولة، ثم اعرض الاستعادة مع فحص التعارض.
- اختبر: تعديل ثم تنقل فورًا، تعديل ثم export، فشل الشبكة، revision conflict، وتعديل جديد أثناء save قيد التنفيذ.

**معيار القبول:** لا يختفي آخر تعديل بصمت في أي مسار تنقل مدعوم.

#### P1-05: بوابة OCR الإقليمي غير جاهزة للتمكين

**الدليل:** الدليل الحالي stale، والقياس التاريخي للـ holdout يساوي CER 27.02% مقابل الهدف ≤25%.

**الحالة الصحيحة حاليًا:** `PDF_REGION_OCR_ENABLED=false`، و`/v1/capabilities` يمنع ظهور الأداة كجاهزة. هذا fail-closed سليم، ومعالجة PDF العادية مستقلة.

**الإصلاح قبل التمكين:** corpus مختوم جديد، بصمة implementation مطابقة، holdout غير مستخدم في التطوير، CER ضمن الهدف، واختبارات للغات/الدوران/الدقة/المساحات، ثم تفعيل تدريجي feature flag.

**معيار القبول:** لا يمكن لأي إعداد إنتاج تمكين الأداة إذا كانت البينة ناقصة أو stale أو خارج الحد.

#### P1-06: أدلة الإنتاج الخارجية لم تُنفذ

ينقص إثبات فعلي للآتي:

- PostgreSQL وRedis وSMTP وS3 مُدارة مع TLS وسياسات IAM حقيقية.
- نشر نفس الصور الموقعة إلى staging.
- recovery drill مع RPO/RTO موثقين.
- ضغط وذاكرة بملفات PDF عند الحدود وبالتزامن المتوقع.
- Stripe live test ومراجعة webhook/portal في الحساب الحقيقي.
- Adobe Golden داخل إصدارات Photoshop/After Effects المرخصة المستهدفة.

**معيار القبول:** تقرير مؤرخ لكل بوابة، مرتبط بصورة digest وSHA، مع logs ونتيجة rollback.

### 5.3 P2 — دين تقني ومخاطر صيانة مهمة

#### P2-01: تكرارات دوال مؤكدة قابلة للاستخراج

| الدالة | المواقع | الحكم | الإجراء الآمن |
|---|---|---|---|
| `roundUsage` | `apps/api/src/billing/usage-meter.ts:212` و`apps/api/src/infrastructure/postgres/postgres-usage-meter.ts:247` | تكرار مطابق، خطر اختلاف حساب الفوترة | استخراج helper في billing domain مع parity tests |
| `canonicalJson` | `scripts/ocr-holdout-policy.mjs:95` و`scripts/verify-recovery-manifest.mjs:236` | تكرار مطابق في مسارين مرتبطين بالتوقيع | `scripts/lib/canonical-json.mjs` مع golden fixtures |
| `normalizeArabic` | `scripts/fetch-ocr-corpus.mjs:324` و`scripts/ocr-benchmark-utils.mjs:1` | تكرار مطابق | استيراد utility الحالية بدل النسخة المنسوخة |
| `mapProject` | مستودع المشروع واستعادة نسخة المصدر | تقارب قوي مع اختلاف بسيط في مصدر version | mapper مركزي بعد characterization tests |
| `abortableDelay` — خادم | export worker وretention scheduler | الدلالة متطابقة تقريبًا: resolve عند abort | helper خادمي واحد مع timer cleanup/unref موحد |
| `moveLayer` | `ExportReview.tsx:250` و`LayerDock.tsx:150` | منطق ترتيب متشابه مع قيود UI مختلفة | pure reorder/reindex helper، مع إبقاء orchestration في المكونين |
| `authError` | auth routes وproject routes | اسم وهدف متقاربان، لكن خرائط الأكواد ليست متطابقة | توحيد responder فقط بعد جدول status/code |

**تحذير:** لا توحّد `apps/web/src/lib/api/transport.ts:259` مع تأخير الخادم؛ نسخة المتصفح ترفض Promise عند abort بينما نسخة الخادم تنهي الانتظار بنجاح. التوحيد الأعمى سيغيّر منطق retry.

#### P2-02: أسماء متكررة لا تمثل كودًا مكررًا آمن الحذف

- `clamp` و`round`: كل نسخة لها مجال أو دقة مختلفة.
- `workerLoop`: سير عمل المعالجة يختلف عن سير عمل التصدير.
- `pointerDown/pointerMove`: محرر الصورة وPDF لهما دلالات مختلفة.
- `main/run/submit/cleanup/handleKeyDown`: أسماء محلية عامة، وليست دليل تكرار.

يجب عدم حذف هذه الحالات اعتمادًا على تشابه الاسم.

#### P2-03: اختلاف دلالي محتمل في `normalizeLayerName`

`packages/presets/src/index.ts:51` يطبق تطبيعًا وحدودًا لحماية المخرجات، بينما `LayerDock.tsx:29` يطبق تطبيع واجهة مختلفًا. قد يرى المستخدم اسمًا تقبله الواجهة ثم يعاد تغييره عند الخادم/التصدير.

**الإصلاح:** تعريف contract واحد للاسم النهائي، ودالة presentation منفصلة إن لزم، واختبارات عربية/RTL والمحارف غير المسموحة والطول والتصادم.

#### P2-04: تركّز مسؤوليات في ملفات كبيرة

| الملف | الأسطر التقريبية | الخطر |
|---|---:|---|
| `Workspace.tsx` | 1,272 | حالة UI، تحميل، أدوات، حفظ وتصدير في مكون واحد |
| `processing-service.ts` | 1,212 | قواعد عمليات متعددة وحدود/تحقق وأثر حالة |
| `packages/document-processing/src/index.ts` | 1,115 | API عام وتنفيذ parsing/segmentation مختلطان |
| `export-service.ts` | 936 | preflight، queue، state، verification |
| `processing-worker-runtime.ts` | 802 | orchestration وتشغيل وفشل/leases |
| `processing-routes.ts` | 756 | HTTP validation وتنسيق use cases |
| `ExportReview.tsx` | 715 | منطق ترتيب وفحص وعرض |
| `packages/export-adapters/src/index.ts` | 708 | صيغ متعددة في entry واحدة |
| `projects-client.ts` | 631 | عدة موارد API في عميل واحد |
| `LayerDock.tsx` | 567 | rename/reorder/group/drag/render |

**الإصلاح:** تقسيم حسب use case، لا حسب عدد الأسطر وحده. انقل pure functions أولًا، ثم hooks/application services، مع re-exports انتقالية واختبارات توصيف قبل كل نقل.

#### P2-05: دين CSS وتكرار selectors

- 15 ملف CSS بنحو 7,855 سطرًا و241KB مصدرًا.
- الأكبر: `atelier.css` 1,551، `export-review.css` 848، `workspace.css` 764، `marketing-polish.css` 665، `account-admin.css` 646، `guided-editors.css` 604.
- المسح الميكانيكي وجد 133 selector بسيطًا يظهر مرتين أو أكثر؛ بعضها متعمد بسبب media/layers، وبعضها تراكم override.
- أمثلة عالية التكرار: `marketing-footer` ثماني مرات، و`studio-button` و`marketing-hero` و`secondary CTA` و`marketing-nav` نحو ست مرات.

**الإصلاح:** Stylelint مع قواعد duplicate selectors مناسبة للطبقات، جرد computed styles ولقطات مرئية قبل/بعد، ثم دمج tokens/components/responsive blocks تدريجيًا. يمنع الحذف بالجملة لأن ترتيب cascade جزء من السلوك.

#### P2-06: عدم محاذاة Playwright

`@playwright/test` و`playwright/playwright-core` عند 1.61.1، بينما `@axe-core/playwright` تسبب وجود `playwright-core` 1.62.0 في الجذر. هذا duplication لبروتوكول المتصفح وقد يزيد عدم الاستقرار.

**الإصلاح:** ترقية/تثبيت Playwright وحزمته الأساسية إلى إصدار واحد متوافق، ثم `npm dedupe` وتثبيت lockfile، وإعادة stress E2E.

#### P2-07: نهايات أسطر غير موحدة رغم `.gitattributes`

**CRLF:**

- `GuidedEditors.tsx`
- `auth-client.ts`
- `billing-client.ts`

**Mixed:**

- `ImageGuidanceEditor.tsx`
- `PdfGuidanceEditor.tsx`
- `admin-client.ts`
- `exports-client.ts`
- `projects-client.ts`

**الأثر:** فرق noisy، تضارب غير ضروري، وتحذير Git عند اللمس.

**الإصلاح:** تحويل ميكانيكي إلى LF في commit منفصل بلا تغيير دلالي، ثم فحص `git diff --ignore-space-at-eol` و`git ls-files --eol`.

#### P2-08: release workflow لا يعيد كل أدلة exact SHA قبل النشر

Workflow الإصدار يعيد quality/audit/topology ويبني ويوقع الصور، لكنه لا يعيد browser E2E وdurable integration كاملين صراحة على SHA tag نفسه قبل publish. اعتماد نجاح سابق على `main` صالح فقط إذا فُرضت required checks وعدم إمكان tag غير موثق.

**الإصلاح:** workflow reusable واحد يأخذ SHA ويشغل quality + durable integration + browser E2E + topology + web smoke قبل publish، أو يتحقق تشفيريًا من required check suite لنفس SHA.

#### P2-09: مصفوفة PDF المحلية صغيرة جدًا

يوجد ملفان فقط:

- `motionprep-e2e.pdf`: 1,278 bytes.
- `motionprep-scanned-arabic.pdf`: 46,900 bytes.
- الإجمالي: 48,178 bytes.

هذه الأصول مفيدة للحتمية وسرعة smoke tests والتحقق من المسار العربي الممسوح، لكنها لا تمثل واقع PDF.

**ينقص:** RTL/LTR مختلط، خطوط embedded/subset، vector وtransparency، crop/rotation boxes، ملفات encrypted/invalid، xref متضرر، صفحة واحدة كبيرة، 250 صفحة، وحد 30MiB وما فوقه، ملفات بلا text layer، وتعدد أحجام/دقة المسح.

#### P2-10: حدود CSRF وrequest ID قابلة للتقوية

- cookies آمنة وHttpOnly وSameSite=Lax، وCORS/same-origin يقللان المخاطرة، لكن لا يوجد token صريح أو تحقق Origin/Referer لكل mutation. هجوم من subdomain ضمن نفس site يبقى سيناريو دفاع متقدم.
- Fastify قد يقبل `x-request-id` من العميل في الوصول المباشر؛ Nginx يستبدله في الإنتاج. ينبغي بقاء API داخلية والتحقق من طول/محارف الهوية أو توليدها خادميًا.

**الإصلاح:** Origin validation لمسارات cookie-auth المتغيرة للحالة، ثم double-submit CSRF إذا أُدخل cross-origin مستقبلًا؛ وتقييد request-id.

#### P2-11: CSP ما زالت تسمح بـ inline styles

`style-src 'unsafe-inline'` مستخدمة بسبب inline React styles. لا يوجد `unsafe-inline` للـ scripts، ولذلك الخطر محدود مقارنة بذلك، لكنه يمنع CSP أكثر صرامة.

**الإصلاح:** نقل القيم الديناميكية إلى CSS custom properties/classes أو nonce strategy، ثم إزالة الاستثناء تدريجيًا.

### 5.4 P3 — تحسينات منخفضة المخاطر

- تحديثات minor متاحة لـ AWS SDK، Fastify/rate-limit، `pdfjs-dist`، Redis client، Stripe، Vite وtypes. تُنفذ في دفعات صغيرة مع lockfile وquality/E2E.
- لا تُنفذ القفزات الكبرى (`zod` 3→4، TypeScript 5→7، Lucide 0.x→1.x) ضمن تنظيف نهائي واحد؛ تحتاج migration مستقلة.
- تحسين cache layers في Dockerfile web بنسخ manifests أولًا قبل المصدر يمكن أن يسرع CI، لكنه ليس عيب تشغيل.
- توسيع accessibility إلى تدفقات لوحة الإدارة والفوترة والمحررات، لا الاكتفاء بصفحة الدخول والمسار الأساسي.

---

## 6. المسارات المكسورة: النتيجة الدقيقة

### 6.1 لا توجد مسارات ثابتة مكسورة مؤكدة

الأدلة الآتية نجحت:

- imports وTypeScript resolution.
- build لكل workspaces.
- `verify:architecture` و`verify:deployment` وعقود البيئة والاسترداد.
- كل روابط Markdown المحلية.
- تسلسل migrations 001–027.
- رحلة التسجيل → المشروع → الرفع → المعالجة → حفظ المراجعة → التصدير → التنزيل.
- asset URLs الموقعة بالبصمة، مع 200 ثم 304.

### 6.2 الحالات التي قد تُفهم خطأً كمسار مكسور

1. **صفحة الهاتف البيضاء:** متذبذبة وليست ثابتة؛ تحتاج تشخيص readiness كما في P1-02.
2. **`.env.production` غير موجود:** هذا مقصود أمنيًا؛ الموجود template فقط. بيئة الإنتاج لن تبدأ دون secrets وقيم فعلية محمية.
3. **OCR الإقليمي غير ظاهر:** تعطيل مقصود بسبب بوابة جودة، وليس كسرًا في مسار PDF العام.
4. **Adobe/Stripe/cloud staging غير ناجحة محليًا:** لم تُنفذ أصلًا في بيئة المزود، فلا يجوز وصفها ناجحة أو مكسورة.

---

## 7. الكود الميت وغير المستخدم

### 7.1 النتيجة

لم يعثر Knip أو ESLint أو TypeScript على ملفات أو dependencies أو exports غير مستخدمة قابلة للحذف بثقة. كما لم يظهر مسح `TODO/FIXME/HACK/NotImplemented` أي stub تنفيذي غير مكتمل؛ نتائج كلمة placeholder كانت حقول form أو توثيقًا/تحقق إعدادات.

### 7.2 لماذا لا نعتبر 0% coverage كودًا ميتًا؟

ملفات مثل `server.ts` ونقاط دخول العمال قد تكون runtime entrypoints أو تُحمّل ديناميكيًا، ولذلك لا تمر عبر unit test import graph رغم ضرورتها. كذلك مكونات route-level قد تُستدعى من التطبيق لا من اختبار مباشر.

### 7.3 بروتوكول الحذف الآمن

لا يُحذف ملف أو export إلا بعد:

1. إدخال كل `src` في coverage denominator.
2. جرد package exports وCLI/worker/Docker entrypoints وdynamic imports.
3. بحث imports المباشرة وغير المباشرة والتحميل بالاسم.
4. اختبار build + topology + E2E من commit الحذف.
5. حذف في commit معزول يمكن عكسه، لا داخل refactor كبير.

بناء على الدليل الحالي، **لا توجد قائمة حذف موصى بها الآن**.

---

## 8. اكتمال الأدوات والوظائف

### 8.1 سجل أدوات مساحة العمل

السجل النشط يحتوي على 19 أداة، وكلها مصنفة `ready` وفق السياق والقدرات:

- الصور: keep، exclude، separate، erase، undo، redo، edge-refine، merge.
- PDF: heading، line، topic، exclude/ignore، reading-order، undo، redo، region-OCR، split، merge.
- نسخ المصدر والاستعادة.

`pdf.region-ocr` ليست جاهزة في الإنتاج الحالي لأن الخادم يعيد capability معطلة. الواجهة تفشل مغلقًا ولا تقدمها كميزة فعالة.

### 8.2 الوظائف المؤجلة عمدًا

هذه ليست stubs خفية؛ هي أعمال منتج/تشغيل مؤجلة وموثقة:

- Paymob live adapter.
- refunds يطلقها المدير من الواجهة.
- استعادة review revision قديم بنقرة واحدة؛ الموجود حاليًا هو استعادة source version، وهما شيئان مختلفان.
- Adobe Golden validation في برامج Adobe المرخصة.
- staging على مزود cloud حقيقي، recovery drill، load/memory exercise.
- Stripe live merchant validation.

### 8.3 حدود المنتج المركزية

- الرفع: 30 MiB.
- PDF: حتى 250 صفحة و100,000 عنصر نصي.
- الصورة: حتى 15 طبقة؛ الفائض يُجمع وفق منطق المعالجة.
- أنواع المصدر: PNG/JPEG/WebP/AVIF/TIFF/BMP/PDF.
- تصدير الصور: PSD، layered TIFF، transparent PNGs، PNG layers JSON.
- تصدير الكتب/PDF: PSD، PNG layers JSON، TXT، CSV، JSON.

**ملاحظة صدق مهمة:** PSD الناتج من PDF يستخدم طبقات نص rasterized، وليس نص Adobe قابلًا للتحرير. يجب إبقاء هذه الصياغة واضحة حتى اكتمال Adobe Golden.

---

## 9. مراجعة الأمان

### 9.1 ما يعمل بصورة جيدة

- Helmet وHSTS في الإنتاج.
- cookies: Secure وHttpOnly وSameSite=Lax.
- CORS origin محدد، وإعداد نشر same-origin.
- rate limiting موزع عبر Redis، وreadiness يفشل مغلقًا عند غيابه.
- `no-store` لمسارات `/v1` و`/internal` افتراضيًا.
- S3 خاص، وفحص بصمات الأصول قبل الاستخدام.
- تحقق TLS لـ PostgreSQL/Redis/SMTP/S3 في بوابات البيئة.
- containers غير root، read-only، capabilities مسقطة و`no-new-privileges` وtmpfs وحدود موارد.
- raw-body والتحقق من توقيع Stripe webhook، مع idempotency وترتيب الأحداث.
- Trivy وCosign/SBOM/provenance في خط الإصدار.
- `npm audit` صفر ثغرات معروفة وقت الفحص، ومسح الأسرار لم يجد سرًا حقيقيًا.

### 9.2 ما يحتاج تقوية

- صدق حالة الدفع P1-03.
- Origin/CSRF وrequest-id في P2-10.
- إزالة `unsafe-inline` للأنماط مستقبلًا.
- إعادة تشغيل CodeQL وsecret scanning وcontainer scan على SHA المدمج، لا اعتبار الفحص المحلي بديلًا.
- حماية direct API من الإنترنت؛ Nginx/ingress هو حد الثقة المتوقع.

لا يوجد دليل حالي على SQL injection أو path traversal أو تسريب secret أو تجاوز صلاحية مؤكد، لكن هذا الحكم مشروط بالمحتوى المحلي المفحوص وليس إعلان امتثال رسمي.

---

## 10. المزامنة والكاش واتساق البيانات

### 10.1 نقاط القوة

- PostgreSQL هو مصدر الحقيقة لحالات المشاريع والرفع والمعالجة والتصدير والفوترة.
- Redis مستخدم للحالة المؤقتة/التحديد الموزع، وليس بديلًا عن سجلات العمل الدائمة.
- upload finalization ذري مع reconciler للحالات القديمة أو المنقطعة.
- email outbox داخل معاملة مع بيانات الأمان ثم dispatcher بleases ومحاولات.
- worker fencing/drain والتعامل مع restart موجودة ومختبرة في topology.
- مراجعة الطبقات تستخدم revision optimistic concurrency وتعيد conflict صريحًا.
- أصول الطبقات immutable فقط عندما يكون URL محتوًيا SHA مطابقًا؛ `ETag/304` متحقق منه.
- Nginx يخزن `/assets` ذات الأسماء الموقعة طويلًا، بينما SPA no-cache لتجنب HTML قديم يشير إلى حزم جديدة.

### 10.2 الفجوات

- flush عند مغادرة مساحة العمل P1-04.
- ينبغي توثيق TTL/retention لكل من upload intents، sessions، reset tokens، outbox، audit، exports والملفات المؤقتة في جدول واحد، مع owner واختبار cleanup.
- ينبغي إضافة metrics صريحة لـ reconcile count، stale leases، outbox lag، webhook lag، cache 304 ratio وrevision conflicts.
- اختبارات clock skew وانتهاء الروابط الموقعة وإعادة المحاولة بعد restart ينبغي أن تكون جزءًا من runbook staging.

---

## 11. مراجعة PDF والأصول

### 11.1 رحلة PDF الحالية

1. إنشاء upload intent بعد التحقق من النوع والحدود.
2. رفع المحتوى إلى التخزين الخاص.
3. finalization يتحقق من الحجم والبصمة والنوع وينشر source version ذريًا.
4. عامل المستند يستخرج النص/الصفحات أو يعالج المسح وفق الإمكانات.
5. ينشأ layer document بمراجعة وrevision.
6. أدوات العناوين/السطور/الموضوعات/الاستبعاد/ترتيب القراءة/التقسيم/الدمج تحفظ التغييرات تفاضليًا.
7. preflight يمنع التصدير عند blockers.
8. عامل التصدير ينشئ الصيغة، يتحقق من الناتج، يخزنه، ثم يتيح تنزيلًا مضبوطًا.

### 11.2 فائدة أصول PDF الحالية

- سريعة وصغيرة، وبالتالي مناسبة للاختبارات الحتمية المتكررة.
- تثبت أن المسار الأساسي لا يعتمد على ملف خارجي متغير.
- fixture العربية الممسوحة تضمن وجود مثال OCR/RTL ثابت.
- يمكن ربط hashes بنتائج متوقعة لمنع تغيرات صامتة.

### 11.3 لماذا لا تكفي؟

ملفان بحجم إجمالي أقل من 50KB لا يختبران حدود 30MiB/250 صفحة، ولا تنوع محركات إنشاء PDF، ولا الخطوط والألوان والدوران والتشفير والفساد. ينبغي إنشاء corpus مرخص/عام الملكية مع manifest يذكر المصدر والترخيص والبصمة والنتيجة المتوقعة، مع تقسيمه إلى smoke صغير وnightly ثقيل وholdout سري للجودة.

---

## 12. مراجعة CI/CD والنشر

### 12.1 السلسلة الحالية

- CI على main/PR يشغل secret scan، quality، durable integration مع PostgreSQL/MinIO، browser E2E، container build/Trivy وfixtures.
- release workflow يشغل quality/audit/topology ثم يبني الصور وينشرها ويوقعها ويولد SBOM/provenance.
- production compose يفرض مراجع صور immutable digest ومتطلبات non-root/read-only/healthchecks/drain.

### 12.2 الفجوة الرئيسية

لا توجد بعد سلسلة مثبتة تبدأ من المحتوى المحلي الحالي وتنتهي بصورة موقعة منشورة على staging من SHA نفسه. كذلك ينبغي ضمان إعادة E2E والتكامل الدائم على exact release SHA قبل publish، لا الاعتماد على افتراض أن tag يطابق آخر CI ناجح.

### 12.3 قرار النشر

- **مراجعة محلية وPR:** Go بعد تثبيت التغييرات وتقسيمها.
- **staging محلي عبر Docker:** Go؛ topology ناجحة.
- **staging خارجي مُدار:** No-Go حتى بوابات المزود.
- **إنتاج عام:** No-Go حتى إغلاق P0 وP1 وإثبات rollback.
- **OCR الإقليمي:** No-Go مستقل؛ يبقى feature flag مغلقًا.

---

## 13. خطة التنفيذ المتتابعة مع الحفاظ على العقود والمسارات

### المرحلة 0 — تجميد خط الأساس وحماية العمل الحالي

**الهدف:** تحويل working tree الكبير إلى محتوى قابل للمراجعة دون فقد أو خلط.

1. إنشاء فرع إصدار من HEAD الحالي.
2. فحص الأسرار والمخرجات والأصول قبل staging.
3. حفظ manifest للـ routes وOpenAPI وpackage exports وworkspace tool registry وmigrations hashes.
4. تحويل ملفات line endings الثمانية إلى LF في commit ميكانيكي مستقل.
5. تقسيم الإصلاحات الحالية إلى commits: upload/data، security/email/rate-limit، capabilities/OCR، web conflicts/autosave، worker/runtime، docs/CI.
6. تشغيل `npm run quality` وE2E بعد كل مجموعة عالية المخاطر.

**بوابة الخروج:** working tree نظيف، كل commit قابل للعكس، ولا تغيير route أو contract غير موثق.

### المرحلة 1 — تصحيح بوابات الثقة قبل أي refactor

1. إصلاح تأكيد checkout من الخادم، مع حالات التأخير والفشل والملكية.
2. إصلاح flush/guard للحفظ التلقائي عند التنقل.
3. تثبيت خادم E2E دون watch، وإضافة trace/console/network diagnostics.
4. محاذاة Playwright وdedupe lockfile.
5. إدخال كل ملفات `src` في coverage denominator.
6. إضافة اختبارات مستهدفة لـ BillingPortal وautosave وAppErrorBoundary وcritical clients.

**بوابة الخروج:** لا نجاح دفع من query، لا فقد صامت لآخر تعديل، 20 E2E runs مستقرة، وتقرير coverage شامل منشور.

### المرحلة 2 — تثبيت العقود ومسارات الإنتاج

1. contract tests بين OpenAPI وعملاء الويب للأسماء والمدخلات والأخطاء.
2. اختبار route matrix: auth/role/status/idempotency/conflict لكل mutation.
3. إضافة اختبار exact-SHA release يجمع durable integration وE2E وweb smoke.
4. إضافة PDF boundary fixtures صغيرة مولدة حتميًا، وnightly corpus ثقيل منفصل.
5. إضافة metrics/alerts للـ outbox وworkers وwebhooks وreconciler والتعارضات.

**بوابة الخروج:** كل مسار إنتاج حرج له owner واختبار وسجل رصد وrollback.

### المرحلة 3 — إزالة التكرار المؤكد فقط

الترتيب المقترح:

1. `normalizeArabic` — أقل مخاطرة.
2. `canonicalJson` — مع golden signature fixtures قبل الاستبدال.
3. `roundUsage` — مع parity tests وقيم حدودية.
4. server `abortableDelay` — مع abort/timer/unref tests.
5. `mapProject` — مع snapshot لعقد API.
6. reorder helper لـ `moveLayer` — مع قيود background/page.
7. `authError` — بعد جدول موحد للأكواد والحالات.
8. توحيد عقد `normalizeLayerName` بين الويب والخادم.

**قاعدة:** استخراج واحد في كل commit؛ لا تغيير سلوك مع النقل.

### المرحلة 4 — تفكيك الملفات الضخمة

1. `Workspace.tsx`: hooks منفصلة للتحميل، اختيار المصدر، مراجعة الطبقات، الأوامر، التصدير والتنقل الآمن.
2. `processing-service.ts`: use cases للصورة وPDF والدمج/التقسيم، مع domain validators مشتركة.
3. `document-processing`: parser، segmentation، reading order، OCR adapter، public facade.
4. `export-service`: preflight، job state machine، artifact verification، delivery.
5. `projects-client.ts`: clients حسب resource مع barrel متوافق مؤقتًا.
6. `LayerDock/ExportReview`: pure model operations ثم presentation components.

**الحفاظ على المسارات:** تبقى exports القديمة كـ re-exports مؤقتة، ولا يتغير URL أو schema في commit نقل. أزل shim فقط بعد قياس كل المستهلكين.

### المرحلة 5 — تنظيف CSS وتجربة المستخدم

1. إضافة Stylelint وجرد duplicates مع allowlist للـ media/layers المقصودة.
2. تثبيت visual baselines لصفحات marketing/auth/dashboard/workspace/billing/admin على desktop/mobile.
3. دمج tokens أولًا، ثم buttons/forms/nav/cards، ثم responsive overrides.
4. تحسين رسائل save/payment/worker states، وإتاحة retry ووقت آخر تحديث.
5. توسيع accessibility: focus order، dialogs، keyboard، contrast، reduced motion وscreen readers.

**بوابة الخروج:** لا visual regressions غير معتمدة، وانخفاض overrides دون زيادة specificity.

### المرحلة 6 — بوابات staging الخارجية

1. تجهيز secrets وقيم `.env.production` في secret manager، لا في Git.
2. تشغيل provider-readiness مع TLS الحقيقي وأقل صلاحيات IAM.
3. بناء runtime/web من SHA المدمج، إنشاء SBOM، فحص، توقيع Cosign، وتثبيت digest.
4. نشر digest نفسه إلى staging.
5. smoke للصورة وPDF والبريد وStripe والـ admin والتنزيل والكاش.
6. load/memory عند الحدود، worker scale/restart، وqueue backpressure.
7. backup/restore مع قياس RPO/RTO.
8. rollback إلى digest سابق بلا rebuild.
9. Adobe Golden على المنتجات والإصدارات المرخصة المستهدفة.

**بوابة الخروج:** تقرير Go/No-Go مرتبط بـ SHA وdigests وبأدلة قابلة للمراجعة.

### المرحلة 7 — الإصدار والمراقبة

1. نشر canary أو نسبة صغيرة.
2. مراقبة 5xx، latency، queue age، outbox/webhook lag، memory، export failures وrevision conflicts.
3. وقف تلقائي/rollback عند تجاوز SLOs.
4. توسيع تدريجي ثم post-release review.
5. إبقاء OCR الإقليمي مغلقًا حتى ينجح مساره المستقل.

---

## 14. قواعد إلزامية لمنع كسر المسارات أثناء التنفيذ

1. **اختبار توصيف قبل النقل:** ثبت السلوك الحالي حتى لو كان التنفيذ سيئ البنية.
2. **لا تجمع refactor وتغيير contract:** كل منهما commit/PR منفصل.
3. **لا تغيّر route بلا compatibility window:** استخدم alias/deprecation ومقياس استخدام قبل الإزالة.
4. **العقود في `@motionprep/contracts`:** الحدود والأنواع والأكواد المشتركة لا تُنسخ في الويب والخادم.
5. **الهجرات forward-only:** لا تعدل migration منشورة؛ أضف واحدة جديدة واختبر إعادة التشغيل والتزامن.
6. **الصور بالـ digest لا tag متحرك:** staging والإنتاج يستخدمان نفس digest.
7. **feature flag لكل ميزة غير مكتملة:** الحالة الافتراضية fail-closed.
8. **لا حذف اعتمادًا على coverage فقط:** راجع entrypoints وdynamic imports والعمال والسكربتات.
9. **golden fixtures للدوال الحساسة:** canonical JSON، الفوترة، export manifests وOCR.
10. **rollback معرف قبل merge:** كود قابل للعكس، ومهاجرات additive، ومسار بيانات لا يعتمد على downgrade مدمر.

---

## 15. معايير الاكتمال النهائية

يصبح البناء مؤهلًا لقرار Go عندما تتحقق جميع البنود التالية:

- لا تغييرات غير مثبتة، وSHA الإصدار معروف ومراجع.
- quality وaudit وdurable integration وE2E وtopology ناجحة على SHA نفسه.
- coverage denominator يشمل كل ملفات الإنتاج، مع اختبارات للمسارات الحرجة المذكورة.
- لا نجاح دفع مبني على query string، ولا فقد تعديل عند التنقل.
- E2E الهاتف/سطح المكتب مستقر عبر تكرار كافٍ مع traces عند الفشل.
- صور runtime/web موقعة ومفحوصة ومرتبطة بـ SBOM/provenance.
- staging يستخدم PostgreSQL/Redis/S3/SMTP حقيقية مشفرة.
- recovery وrollback وload/memory وAdobe Golden موثقة.
- alerts وdashboards وrunbooks وowners موجودة.
- OCR الإقليمي يظل معطلًا أو يقدم بينة جديدة ناجحة؛ لا توجد حالة وسطية غامضة.

---

## 16. القرار النهائي

**جودة الأساس المعماري:** جيدة، مع تطبيق فعلي لمبادئ المتانة والتشغيل وليس مجرد واجهة.
**وجود أخطاء مكسرة للبناء:** لا؛ البناء والفحوص الأساسية ناجحة.
**وجود كود ميت مؤكد:** لا دليل آمن حاليًا.
**وجود تكرار يستحق الإصلاح:** نعم، لكنه محدود ومحدد، ويجب استخراجه انتقائيًا.
**وجود مسارات ثابتة مكسورة:** لا؛ يوجد تذبذب E2E ومخاطر حالة/تنقل تحتاج إصلاحًا.
**جاهزية الإنتاج العام:** No-Go مؤقتًا.
**أولوية العمل التالية:** تثبيت Git وصدق بوابات الاختبار، ثم الدفع والحفظ وE2E، ثم التكرار وإعادة الهيكلة، ثم staging والإصدار الموقع.

النهج الأكثر أمانًا ليس «تنظيف كل شيء» في دفعة واحدة، بل سلسلة تغييرات صغيرة محمية بعقود واختبارات وقياسات. بهذه الطريقة يمكن رفع جودة الكود من دون التضحية بالمسارات والأدوات التي تعمل اليوم.
