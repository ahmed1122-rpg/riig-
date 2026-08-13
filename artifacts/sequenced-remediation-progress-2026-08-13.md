# سجل تنفيذ خطة الإصلاح المتتابعة — 2026-08-13

هذا السجل يربط التنفيذ الفعلي بخطة
`comprehensive-production-code-layer-audit-and-final-remediation-plan-2026-08-13.md`.
لا يعني نجاح مرحلة محلية أن المشروع أصبح جاهزًا للنشر؛ تظل بوابات الخدمات
المدارة وبيئة staging والإصدار الموقّع ضمن المراحل اللاحقة.

## المرحلة 0 — مكتملة

- فُكّت دورة الاستيراد بين Workspace Chrome وMobile Sheet باستخراج عقدة
  `WorkspaceMobilePanel` إلى وحدة مستقلة، ونجح فحص DAG.
- ثُبّت عقد PDF في API: مجموعة الصفحة أولًا، الخلفية ابن مباشر لها، وكل طبقات
  النص مرتبطة بالمجموعة مع ترتيب قراءة صريح.
- أزيلت الصادرات الميتة وعمليات merge/split المحلية غير المدعومة، وحُذف CSS
  المتروك وأضيف اختبار يمنع عودتها حتى عندما يكون التصدير غير جاهز.
- عُزل E2E على API `45100` وWeb `45101` افتراضيًا، بذاكرة وخدمات inline وبدون
  قراءة `.env` أو إعادة استخدام خادم موجود.
- استُبدلت wrappers الثقيلة للأيقونات بعارض SVG مشترك، مع اختبار بصمة يغطي
  كتالوج الأيقونات كاملًا (67 اسمًا)، وحُذفت تبعية `lucide-react` غير اللازمة
  مع حفظ ترخيص بيانات المتجهات في `NOTICE`.
- أُعيد polyfill الخاص بـ`modulepreload` إلى سلوك Vite الافتراضي بدل الاعتماد
  على افتراض متصفحات غير موثق.
- أزيلت مخلفات cache المؤقتة وأضيفت إلى ignore.

### أدلة القبول

| البوابة | النتيجة |
|---|---|
| E2E كامل — desktop/mobile Chromium | 12/12 ناجحة، 1.8 دقيقة |
| `npm run quality` — الجولة الأولى النهائية | ناجحة، 202.6 ثانية |
| `npm run quality` — الجولة الثانية النهائية | ناجحة، 201.0 ثانية |
| عقد API | 75 عملية و41 migration |
| الصيانة | 422 ملفًا، 0 oversized، 0 clone blocks |
| Web coverage | 47.18% statements، 44.64% branches، 39.81% functions، 48.78% lines |
| Bundle gzip | JavaScript 167.8 KiB، CSS 44.0 KiB |
| `git diff --check` | ناجح |

ملاحظة تشغيلية: تشغيل Playwright داخل sandbox المقيّد على Windows علّق عند
`Terminating the WebServer` لأن Playwright يستخدم `taskkill /T /F`. التشغيل
نفسه خارج هذا القيد أنهى الخوادم طبيعيًا ورجع `0`؛ الرحلة القصيرة نجحت في
18.5 ثانية، ثم المجموعة الكاملة نجحت 12/12.

## المرحلة 1 — مكتملة محليًا

- أصبح إدراج processing/export job وتفعيل project fence معاملة واحدة، وأصبح
  claim وتسوية الحالة النهائية مشروطين بـCAS؛ فشل fence يعيد المعاملة كاملة.
- استعادة المصدر تقفل المشروع، وترفض job أو upload نشطًا، وتعيد فحص المصدر
  الحالي والحواجز في `UPDATE`. أضيف project advisory lock مشترك مع تخصيص رقم
  source version، وحاجز زمني محدود للـsource الذي بدأ الرفع قبل نشر الجلسة.
- أضيف tombstone/drain/final inventory لحذف الحساب مع processor claim، وحواجز
  DB تمنع إنشاء مشاريع أو اشتراكات مدفوعة أو نشر محتوى بعد بدء الحذف.
- أصبحت كل كتابة إنتاجية إلى التخزين محمية بـdurable object-write lease مع
  heartbeat وcooldown نشر 15 دقيقة؛ الكتابة الفاشلة أو الملتبسة أو غير المنشورة
  تُحذف permanent purge، بما يشمل نسخ S3 التاريخية.
- أصبح retention يعمل claim ثم purge ثم finalize، مع حماية المراجع الحالية
  و`ready` character models، وإصلاح مفاتيح export التاريخية.
- أصبح استهلاك TOTP challenge وrecovery code ذريًا، مع اختبارات سباق 20×20،
  وأصبحت الهجرات محدودة بمهلات advisory/lock/statement موثقة.
- أغلقت المراجعة المستقلة سباقات upload intent، إعادة export بلا approval،
  تصادم export ID، وفشل processing terminal CAS، ثم كشفت وأُغلقت نافذة restore
  أثناء upload.

### أدلة القبول المحلية

| البوابة | النتيجة |
|---|---|
| API كامل بعد آخر إصلاح | 103/103 ملفًا، 439/439 اختبارًا |
| restore/upload contract | 8/8 اختبارات مركزة |
| TypeScript API | ناجح |
| ESLint للملفات الأخيرة | ناجح |
| العقود | 75 عملية API و42 migration |
| المعمارية | ناجحة |
| الصيانة | 437 ملفًا، 0 oversized، 0 clone blocks |
| `git diff --check` | ناجح |

### دليل مؤجل إلى المرحلة 6

لم تتوفر في هذه البيئة `INTEGRATION_DATABASE_URL` ولا خدمة S3 versioned
مدارة. لذلك اختبارات PostgreSQL الحقيقية (السباقات والأقفال وMFA) واختبار
حذف `Versions/DeleteMarkers` وIAM ليست نجاحًا مدعى؛ الاختبارات مكتوبة وتبقى
بوابة إلزامية في staging قبل حكم GO.

## المرحلة 2 — مكتملة محليًا

- أضيفت حزمة `@motionprep/layer-domain` بوصفها المصدر الموحد لفحص graph
  والتسمية ضمن parent/page، واستحقاق دمج النص وRaster، وpreflight الإنتاجي.
  يغطي الفحص المعرفات والأسماء المكررة، orphan/non-group parent، الدورات،
  cross-page parent، المجموعات الفارغة، ومجلد/خلفية كل صفحة PDF.
- أضيف endpoint ذري لأوامر الطبقات يدعم normalize، ترتيب القراءة وعكسه،
  hide/lock الجماعي، والنقل؛ يطبق الأمر كله بحفظ CAS واحد ويدعم 5000 طبقة
  ويرفض 5001 دون حفظ جزئي.
- أصبح merge الحقيقي server-only وتستخدم الواجهة قواعد الأهلية المشتركة قبل
  الإرسال، مع منع الدمج عبر الصفحة أو الأب وحماية fixed/locked.
- أضيف `DocumentCommandCoordinator` واحد لعمليات الوثيقة؛ يسلسل الأوامر، يعمل
  flush قبل الأوامر المتعارضة واستبدال/استعادة المصدر، ويرفض تبني نتيجة تخص
  source قديمًا.
- أصبحت حماية المصدر الحالي موجودة في route وفي مستودع PostgreSQL نفسه، ولا
  تُحفظ مراجعة وثيقة قديمة بعد استبدال المصدر.
- أصبحت guidance تتجاهل fixed/locked، تولد أسماء فريدة، وتحذف المجموعات
  الدلالية الفارغة الناتجة عن المناطق المتداخلة.
- رُبطت أوامر LayerDock الجماعية بالخادم، وأزيل الزر المحلي غير الحقيقي،
  وأصبح autosave وExportReview يحميان كل طبقة fixed.
- فُصل منطق mutation وتحويل command request عن ملف المسارات؛ ملف
  `processing-routes.ts` عاد بهامش آمن تحت سقف 550، وخط أساس العقود يسجل
  العملية والحزمة الجديدتين صراحة.

### أدلة القبول المحلية

| البوابة | النتيجة |
|---|---|
| اختبارات المستودع كاملة | ناجحة لجميع مساحات العمل |
| API | 105/105 ملفات، 444/444 اختبارًا |
| Web | 49/49 ملفات، 184/184 اختبارًا |
| `layer-domain` | 8/8 اختبارات، ومنها أمر 5000 طبقة |
| document-processing / export / guidance / presets | 50/50، 26/26، 5/5، 13/13 |
| TypeScript لجميع الحزم والعمال | ناجح |
| ESLint كامل | ناجح، 0 warnings |
| البناء الإنتاجي لجميع مساحات العمل | ناجح |
| العقود | 76 عملية API و42 migration |
| المعمارية | ناجحة |
| الصيانة | 446 ملفًا، 0 oversized، 0 clone blocks |
| `git diff --check` | ناجح |

## المرحلة 3 — مكتملة محليًا وبصريًا

- أضيف projection موحد للرؤية والشفافية وSolo وترتيب `zIndex/readingOrder`
  تستخدمه معاينة PDF ومسارات Raster ومعاينة التصدير.
- أصبحت معاينة PDF تدعم click-to-select لأعلى طبقة مرئية، مع active highlight
  وscroll sync إلى صف الطبقة في الرصيف.
- أصبح preflight المحلي مبنيًا على validator الإنتاجي نفسه ويعرض
  `ready/warning/blocked` في الرأس والملخص والتذييل، ويدخل حالة المصدر والحفظ
  في القرار؛ يبقى اعتماد الخادم البوابة النهائية.
- أصبحت إعادة التسمية commit على Enter/blur فقط، مع منع duplicate داخل
  page+parent وخطأ inline، بدل الكتابة إلى الوثيقة مع كل ضغطة.
- تصفّر مناطق PDF عند تغيير segmentation، ويعيد guidance review مزامنة
  revision/state بعد undo/redo أو تبني وثيقة جديدة.
- كشف QA البصري أن تغيير هوية المصدر المقصود بعد الرفع كان يطلق stale guard
  بعد النجاح؛ أضيف `allowIdentityChange` للرفع والاستعادة فقط. أصبحت بطاقة
  المصدر تعرض 100% جاهزًا، وتوقف إنشاء Object URL غير مستخدم لملف PDF.
- أصلح تنقل صفحات التصدير على الهاتف (`inset-inline-start` بدل shorthand
  يصفر العرض)، وأزيلت شارة Safe التي كانت تغطي النص.

### أدلة القبول

| البوابة | النتيجة |
|---|---|
| Web بعد نطاق المرحلة | 51/51 ملفات، 188/188 اختبارًا |
| TypeScript وESLint للويب | ناجحان |
| الصيانة | 449 ملفًا، 0 oversized، 0 clone blocks |
| QA بصري 1440×900 وPixel 7 RTL | المشكلتان المكتشفتان أُصلحتا وأعيد اختبارهُما |
| click-to-select + hide parity | مثبتان في المتصفح الحقيقي |
| preflight وrename inline | مثبتان في الاختبارات والمتصفح الحقيقي |
| Console / network خلال الجولة | لا JavaScript errors أو طلبات فاشلة |

التقرير واللقطات: `artifacts/phase3-browser-qa-2026-08-13/report.md`.

## المرحلة 4 — مكتملة محليًا وبصريًا

- أصبحت فهرسة صفحات PDF O(n)، ولا تُركب أبناء الصفحات المطوية. الصفحة
  المفتوحة تستخدم نافذة 160 عقدة مع «عرض المزيد»، والصور تستخدم دفعات 32.
- أضيف بحث مؤجل وفلاتر ظاهرة/مخفية/مقفلة/نص/Raster/ثقة منخفضة، مع حفظ الفلتر
  وكثافة الصفوف، وأصبح البحث في PDF عابرًا للصفحات دون فتحها جميعًا.
- أضيف محرر هاتف كامل للطبقة النشطة: اسم commit على blur/Enter، duplicate
  scoped، رؤية، قفل، opacity، وتحريك sibling ذري عبر أمر الخادم.
- صار توحيد الأسماء يفتح معاينة diff قبل التنفيذ، يختار multi-selection أو
  الصفحة الحالية تلقائيًا، ويمنع نطاقًا أكبر من 5000. أضيف سجل أوامر جلسة
  بحالات جارٍ/اكتمل/فشل.
- تبويب الفحص يستخدم validator الحقيقي لـgraph ويشخص duplicate IDs/names،
  orphan/non-group parent، cycles، cross-page parent، والمجموعات الفارغة.
- أصبحت ألوان الطبقات مشتقة من ID ثابت، وأزيلت جودة «سريع/كامل» التجميلية،
  واستبدل زر «ملاءمة» الثابت بوسم صادق `75%`.
- نُظفت dependency ودالة وتصديرات types ميتة؛ Knip أصبح نظيفًا.

### أدلة القبول

| البوابة | النتيجة |
|---|---|
| اختبارات المستودع كاملة | ناجحة لجميع مساحات العمل |
| API | 105/105 ملفات، 444/444 اختبارًا |
| Web | 53/53 ملفات، 198/198 اختبارًا |
| fixture الأقصى | 100,000 طبقة/250 صفحة، ≤160 صفًا و<3500 عنصر DOM أوليًا، <8 ثوانٍ |
| TypeScript / ESLint / Stylelint / Knip | ناجحة |
| البناء الإنتاجي لجميع مساحات العمل | ناجح |
| العقود | 76 عملية API و42 migration |
| المعمارية / CSS architecture | ناجحتان |
| الصيانة | 452 ملفًا، 0 oversized، 0 clone blocks |
| الحزمة | JS 174.3 KiB وCSS 44.5 KiB gzip؛ كل JS chunk <64 KiB |
| QA بصري 1440×900 و375×812 RTL | PASS، Axe 0 violations، 0 overflow، 0 console/network errors |
| `git diff --check` | ناجح |

التقرير واللقطات: `artifacts/phase4-browser-qa-2026-08-13/report.md`.

## المرحلة 5 — مكتملة محليًا

- أصبح مسار رفع 30 MiB مقيدًا ببوابة FIFO قابلة للضبط، ويرفض الحجم المعلن أو
  الفعلي فوق الحد بـ413. أثبت اختبار حمل 20×30 MiB أن التزامن الأقصى ثلاثة وأن
  نمو RSS بقي داخل سقف الاختبار. هذا bounded buffering آمن، وليس ادعاء zero-copy.
- أصبحت كلمات المرور الجديدة `scrypt$v2` بمعاملات مصرح بها، وتترقى الصيغة
  التاريخية تلقائيًا بعد دخول ناجح فقط؛ الحساب الموقوف لا يسبب إعادة كتابة.
- أصبح تشفير MFA وrecovery codes مبنيًا على keyring محدود بخمسة مفاتيح مع active
  key ID، وقراءة متوافقة للخلف للصيغة v1، واختبارات تدوير قديم/جديد.
- أصبحت التسجيلات الإنتاجية pending حتى استهلاك رمز بريد أحادي الاستخدام، وإعادة
  الإرسال غير كاشفة للحساب وتبطل الرمز السابق. أضيف bootstrap مسؤول أحادي المرة
  محمي بقفل PostgreSQL، وأثبت سباق 20 طلبًا نجاح واحد فقط محليًا.
- أصبحت رموز التحقق جزءًا من حذف الحساب والتنظيف الدوري، وأضيف audit لأحداث
  الدخول وMFA وكلمات المرور والتحقق والbootstrap دون تسريب الرموز.
- فُصل ملف التحكم عن أسرار migration/API/maintenance وكل worker. يرفض مشغل
  الإنتاج إعادة استخدام ملف أو workload identity أو مستخدم DB أو بيانات S3
  الصريحة. الهجرات تستخدم `MIGRATION_DATABASE_URL` بدور مستقل ومهل محدودة.
- أضيف redaction مركزي لسجلات HTTP، وCSP report-only قابل للقياس مع endpoint
  ينزع المسارات والاستعلامات، وسياسة إبلاغ أمني وترخيص proprietary قابلة للفحص.
- وُثقت مصفوفة IAM حسب runtime، تدوير المفاتيح، إزالة bootstrap، وعدم مساواة
  اختلاف الأسرار بإثبات least privilege لدى المزوّد.

### أدلة القبول

| البوابة | النتيجة |
|---|---|
| اختبارات المستودع الكاملة | ناجحة لكل مساحات العمل |
| API | 112/112 ملفًا، 469/469 اختبارًا |
| Web | 53/53 ملفًا، 198/198 اختبارًا |
| TypeScript / ESLint / Stylelint / Knip | ناجحة، 0 dead exports بعد التنظيف |
| البناء الإنتاجي | ناجح لكل الحزم والتطبيقات والعمال |
| العقود | 79 عملية API و43 migration |
| المعمارية ووثائق API | ناجحتان |
| الصيانة | 458 ملفًا، 0 oversized، 0 clone blocks؛ إنذار 450 وسقف 550 |
| النشر والترخيص الأمني | ناجحان |
| الحزمة | JS 174.8 KiB وCSS 44.5 KiB gzip |
| `git diff --check` | ناجح |

### دليل غير مدعى

لا تتوفر في البيئة الحالية قاعدة PostgreSQL مُدارة، SMTP حقيقي، أو S3 versioned
بهويات IAM مستقلة؛ لذلك سباقات PostgreSQL الحقيقية، تسليم البريد، وleast privilege
لدى المزود تبقى بوابات staging في المرحلة 6 ولا تُحسب PASS محليًا.

## المرحلة 6 — مكتملة محليًا؛ الإصدار الخارجي معلّق

- رُفعت نسخة كل workspaces إلى `0.1.8` دون commit أو tag. أضيف verifier يرفض
  dirty checkout أو اختلاف HEAD/SHA/tag/package version أو صورة بلا digest،
  ويستطيع تنفيذ Cosign repository-bound verification للصورتين.
- أصبحت workflows الخاصة بـprovider/staging/application/performance وrollback
  تعمل checkout صريحًا لـ`RELEASE_GIT_SHA` مع `fetch-depth: 0`، ثم تتحقق من tag
  والتوقيعات قبل تشغيل scripts.
- أصبح worker health مربوطًا بملف instance تكتبه الحاوية نفسها، وبـworker type
  وinstance ID وrelease SHA في استعلام واحد؛ لا يستطيع heartbeat لحاوية أخرى
  إخفاء الحاوية المتوقفة.
- أضيف `/readyz` الذي يعكس API readiness مع بقاء `/healthz` liveness فقط،
  و`MotionPrepApiDown` و`MotionPrepApiMetricsAbsent`. نجح promtool في فحص 22 rule.
- ترقت capability schema إلى 1.1 وتعرض media/document/export/character كـ
  `ready/degraded/not_required` دون إسقاط API كاملًا.
- كشف البناء النظيف أن runtime image لم تنسخ `@motionprep/layer-domain`؛ أضيفت
  للحزمة ولـAdobe generator، وأضيف عقد يمنع حذف أي runtime package أو dist.
- عُزل topology على منافذ بديلة احترامًا لـstack قديم يشغل 55432، وصُححت هوية
  integration الافتراضية وملف worker instance. نجح الاختبار الكامل لاحقًا مع
  PostgreSQL وRedis وMinIO versioning وMailpit ونسختي API وكل العمال، وإعادة
  التشغيل وfault recovery وتحميل PDF المتزامن، ثم نظف حاوياته وشبكته.
- أصلحت بوابة coverage لحزمة layer-domain بإضافة اختبارات حواف فعلية دون خفض
  الحدود؛ النتيجة 30 اختبارًا و99.52% lines و99.13% statements و100% functions.

### أدلة القبول المحلية النهائية

| البوابة | النتيجة |
|---|---|
| API | 112/112 ملفًا، 470/470 اختبارًا |
| Web | 53/53 ملفًا، 198/198 اختبارًا |
| E2E desktop/mobile | 12/12 |
| coverage لكل workspaces | ناجحة بجميع الحدود |
| topology + fault recovery + concurrent load | PASS محليًا داخل Docker |
| Prometheus | 22 rule، promtool PASS |
| npm audit | 0 vulnerabilities |
| TypeScript / ESLint / Stylelint / Knip | PASS |
| build / Adobe Golden داخل runtime image | PASS |
| العقود | 79 عملية API، 43 migration |
| الصيانة | 459 ملفًا، 0 oversized، 0 clone blocks؛ سقف 550 |
| web bundle | JS 174.9 KiB وCSS 44.5 KiB gzip |
| `git diff --check` | PASS |

### قرار النشر

الشفرة محليًا **جاهزة لتكوين مرشح إصدار**، لكن القرار العام يبقى **NO-GO** حتى:

1. مراجعة التغييرات وإنشاء clean commit وtag `v0.1.8` بإذن المالك.
2. نجاح hosted CI وبناء/فحص/توقيع صور 0.1.8 وتسجيل digests الجديدة.
3. نشر نفس digests إلى managed staging وتمرير PostgreSQL/Redis/SMTP/S3/TLS/IAM.
4. توقيع restore drill يثبت RPO≤15m وRTO≤4h، ثم representative 30 MiB load،
   rollback وcanary على نفس SHA/digests.
5. إبقاء regional OCR وCharacter Studio وlive billing معطلة حتى أدلتها المستقلة.

التقرير النهائي: `artifacts/final-remediation-execution-report-2026-08-13.md`.

## جولة الإغلاق المحدثة — 2026-08-13

- نجح API كاملًا: 115/115 ملفًا و481/481 اختبارًا.
- نجح Web كاملًا بعد آخر تنظيفات التنزيل والحراسة: 59/59 ملفًا و216/216 اختبارًا.
- نجح E2E النهائي 12/12 على سطح المكتب والهاتف، بما في ذلك PDF الحقيقي، تصدير الصور،
  تصدير بيانات الحساب، وطلب الحذف الدائم.
- نجح build الإنتاجي وخرجت خرائط المصدر العامة = 0 والخاصة = 19.
- الحزمة النهائية: JS 177.8 KiB وCSS 44.7 KiB gzip؛ البداية 8 طلبات، hero 207.0 KiB،
  ولا خطوط حاجبة.
- نجح topology تلقائي المنافذ مع fault recovery وحمل رحلتين PDF متزامنتين: 0 فشل
  وworkflow p95 = 1462ms.
- نجحت الصيانة على 467 ملف إنتاج: 0 ملف فوق 550 و0 exact clone blocks، مع إنذار مبكر
  غير مانع من 450 إلى 550.
- نجح deployment verifier 26/26، والعقود 79 عملية API و43 migration، وPrometheus
  يحوي 24 قاعدة ناجحة، و`npm audit` يسجل 0 ثغرات.

الحكم النهائي لم يتغير: **GO لتكوين مرشح إصدار محلي، وNO-GO للنشر العام** حتى clean
commit/tag وhosted CI وصور موقعة وmanaged staging وrestore/rollback/canary لنفس SHA/digests.
