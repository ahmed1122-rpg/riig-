# خطة الإغلاق المتبقية — MotionPrep

**آخر تحديث:** 2026-07-31  
**الوضع:** الأدوات الست مكتملة محليًا. المتبقي هو قرار نطاق OCR، بوابات topology، وأدلة الإنتاج الخارجية.

## 1. ما أُغلق

| العمل | الحالة | دليل القبول المحلي |
|---|---|---|
| استعادة إصدار المصدر | مكتمل | route + migration 021 + history UI + conflict/idempotency |
| مراجعات الطبقات الدائمة | مكتمل | migration 022 + snapshots + CAS + retention |
| فصل/دمج PDF | مكتمل | API/UI + RTL geometry + undo/redo |
| OCR إقليمي | مكتمل | source crop + worker + replay/undo + kill switch |
| تحسين الحواف | مكتمل | derived PNG + integrity + cleanup + undo |
| دمج Raster | مكتمل | alpha composite + z-order + derived asset + undo |
| دورة OCR v6 المحايدة | مكتملة | مصادر جديدة، فتح واحد، بصمات مثبتة، تقرير رسمي |
| quality وE2E | مكتملان | quality ناجح وPlaywright ‏4/4 |
| الهجرات وPostgreSQL/S3 | مكتمل | concurrent migrations + integration ‏8/8 |
| topology الإنتاجي المحلي | مكتمل | replicas + Redis + Mailpit + MinIO + workers + restart/export/webhook |
| بناء صور Docker | منشور وموقّع على GHCR | الإصدار v0.1.0 بالـdigest وSBOM/provenance وصفر High/Critical وتوقيعا Cosign keyless متحققان وhardened web smoke |

## 2. P0 — قرار نطاق OCR

يوجد مساران مشروعان، ولا يجوز خلطهما:

### المسار الموصى به: إصدار المطبوعات فقط

1. اعتماد وصف المنتج: OCR مساعد للمطبوعات العربية، لا للمخطوطات أو الجداول التاريخية المتدهورة.
2. إبقاء `needs_review` إلزاميًا عندما تقل الثقة النهائية عن 0.35.
3. إضافة نص واضح في UI والتصدير بأن الصفحات منخفضة الثقة تحتاج اعتمادًا بشريًا.
4. منع ادعاء “نسخ آلي مضمون” في التسويق والمساعدة.
5. اعتماد gate منفصل للمطبوعات فقط بقرار مالك موثق؛ لا يُغيّر benchmark التاريخي ولا يحذف عيناته.

**دليل القبول:** مصدر holdout المطبوع في v6 عند 16.26%، validation عند 15.13%، ولا صفحة مطبوعة تتجاوز 50%.

### المسار الموسع: دعم المخطوطات والجداول

1. إنشاء holdout v7 من مصدرين جديدين لم يُستخدما سابقًا، أحدهما مخطوط والآخر جدول/طباعة متدهورة.
2. إدخال حد `OcrEngine` لمزود بديل محلي مع manifest نموذج وبصمة وترخيص وkill switch.
3. تقييم محركات مخصصة للمستندات التاريخية، مع تشغيل معزول واستهلاك ذاكرة وزمن مقاسين.
4. الاختيار على development ثم validation فقط، مع معايرة confidence وحفظ الإحداثيات.
5. تجميد الكود والنماذج والـlockfile، ثم فتح v7 مرة واحدة.

**دليل القبول:** الإجمالي وholdout ≤25%، كل صفحة ≤50%، لا تراجع validation، ولا نتيجة منخفضة الثقة تمر بلا مراجعة.

## 3. P0 المحلي — مكتمل

1. نجح تشغيل PostgreSQL/S3 integration بعد migrations 021/022: ‏8/8.
2. نجح `npm run test:topology:full` على نسختي API وثلاثة عمال وPostgreSQL وMinIO وRedis وMailpit.
3. ثبتت سلامة الهجرات المتزامنة وإعادة التشغيل idempotent.
4. ثبتت استعادة المصدر وleases والاحتفاظ والتصدير تحت معاملات PostgreSQL الحقيقية.
5. ثبتت health/readiness/metrics وإعادة تشغيل API وworker وتحقق webhook الموقّع.
6. أُصلح تشغيل Docker من مسارات Windows العربية باستخدام junction مؤقت يُنظف دائمًا.

## 4. P0 خارجي — إثبات الإنتاج

| الترتيب | العمل | المتطلب من المالك/البيئة | دليل القبول |
|---:|---|---|---|
| 1 | تفعيل branch protection | remote وCI موجودان | فرض quality وCodeQL ومنع force-push على `main` |
| 2 | تحقق S3 الفعلي | OIDC role أو مفاتيح مؤقتة وbucket | TLS/versioning/encryption/retention/read-delete |
| 3 | staging وrollback | صور GHCR الموقعة المنشورة | journey وrollback بلا rebuild |
| 4 | تمرين الاستعادة | backup حقيقي ومفتاح Ed25519 محمي | RPO≤15m وRTO≤4h وmanifest موقّع |
| 5 | Adobe Golden | ترخيص فعّال | فتح PSD/AE وتقرير اختلافات موقّع |

## 5. P1 — الارتقاء بالأدوات والكود

1. إضافة مصنف قدرات للصفحة يميز: مطبوع عادي، تخطيط جدولي، مخطوط، ودقة منخفضة؛ يستخدم للتحذير والتوجيه لا لتغيير benchmark.
2. توحيد محركات OCR خلف واجهة مزود واحدة مع timeouts وcircuit breaker وقياس RSS/p95 وإصدار نموذج.
3. إضافة معايرة confidence حسب نوع الصفحة، مع اختبار عدم مرور النتائج السيئة بصمت.
4. توسيع SBOM/provenance والتوقيع keyless المكتمل للصور إلى النماذج والـlockfile.
5. إضافة اختبارات chaos للـqueue: lease loss، retry exhaustion، stale revision، وفشل نشر الأصل المشتق.
6. قياس أحجام revisions والأصول المشتقة ووضع تنبيهات retention/capacity.

## 6. التشغيل والتعطيل والرصد

- `PDF_REGION_OCR_ENABLED=false` يوقف إنشاء مهام OCR الإقليمية ويرد 503 دون تعطيل بقية PDF.
- فشل OCR لا يغيّر وثيقة الطبقات؛ النشر يستخدم CAS داخل transaction.
- إعادة المحاولة آمنة بمفتاح idempotency، والتعارضات الحتمية لا تعاد بلا حد.
- راقب route `/layer-document/text/region-ocr` مع queue age/retry/lease loss/duration.
- عند فشل OCR >10% خلال 15 دقيقة أو queue age >120 ثانية: فعّل kill switch واحتفظ بالتحرير اليدوي.

## 7. تعريف الاكتمال النهائي

لا يعلن `Production Approved` إلا باجتماع ما يلي:

1. Git/CI على SHA ثابت.
2. quality وE2E وtopology الحي خضراء.
3. قرار نطاق OCR موثق: إما holdout جديد ناجح، أو نطاق مطبوعات فقط مع gate وإفصاح معتمدين.
4. أدلة S3 وstaging وrollback وrecovery وAdobe فعلية وموقعة.
5. runbooks والتنبيهات وkill switches مجرّبة.

**القرار الحالي: No-Go للإنتاج العام.** لا توجد أدوات وهمية متبقية؛ اكتمل remote وCI والنشر والتوقيع keyless على GHCR، والعوائق هي حد قدرة OCR المثبت وغياب branch protection وبيانات المزود وstaging والاستعادة وAdobe.
