# ملحق إثبات مرشح الإصدار — MotionPrep Studio

**مرشح الكود:** `e7119472d83fb5dec7ff9f563815f5be7030e8e7`

**الفرع:** `codex/release-hardening-2026-08-03`

**تاريخ التنفيذ:** 2026-08-03

## نتيجة البوابات

| البوابة | النتيجة | الدليل المختصر |
|---|---|---|
| `npm run quality` | ناجح | المعمارية، الصيانة، النشر، الاستعادة، OCR، lint، CSS، Knip، الأنواع، التغطية، البناء وميزانية الحزمة |
| `npm run test:e2e` | ناجح | 8/8 على desktop Chromium وmobile Chromium |
| `npm run test:topology:full` | ناجح | نسختا API، PostgreSQL، Redis، MinIO، Mailpit، ثلاثة عمال، restart، export وStripe webhook موقع |
| تنظيف Docker | ناجح | لا حاويات متبقية لمشروع `motionprep-integration` بعد الاختبار |
| هوية الدليل | ناجح | تقرير الأعطال يحمل SHA الكامل نفسه |

## اختبار الأعطال والتعافي

| التبعية | زمن الدورة | اكتشاف الانقطاع | عودة readiness | عودة المقاييس | عودة العمال |
|---|---:|---|---|---|---|
| Redis | 6.492 ث | نعم | نعم | نعم | نعم |
| MinIO / object storage | 13.751 ث | نعم | نعم | نعم | نعم |
| Mailpit / SMTP | 45.923 ث | نعم | نعم | نعم | نعم |
| PostgreSQL | 11.558 ث | نعم | نعم | نعم | نعم |

كشفت المحاولة الأولى أن `/internal/metrics` يتجاوز مهلة scrape عند سقوط PostgreSQL لأن snapshot وفحوص التبعيات وreadiness كانت متسلسلة. تم إصلاح المسار بتشغيل probes بالتوازي وتحديد كل probe بثلاث ثوانٍ، مع اختبار لحالة promise لا تنتهي. أعيدت الدورة كاملة بعد الإصلاح ونجحت الحالات الأربع.

## حمل PDF المتزامن

| المقياس | النتيجة |
|---|---:|
| التزامن | 2 |
| الرحلات الكاملة | 2 |
| النجاحات | 2 |
| الإخفاقات | 0 |
| معدل الخطأ | 0% |
| workflow p50 | 1,674 ms |
| workflow p95/p99 | 1,699 ms |
| processing-ready p95 | 548 ms |
| export-ready p95 | 558 ms |
| download p95 | 51 ms |
| نمو API RSS | 2,707,456 bytes |
| ذروة نمو worker RSS | 524,288 bytes |
| نمو API heap | 1,814,704 bytes |
| عمق الطابور النهائي | 0 |

هذا اختبار smoke متزامن وليس اختبار سعة مستدامًا أو قريبًا من الحد. يثبت سلامة الرحلة والمقاييس وتصريف الطابور، ولا يثبت طاقة 1,000–5,000 مستخدم.

## بصمات الأدلة الخام المحلية

احتفظ التشغيل بالملفين الخام داخل `.tmp/` المستبعد من Git. البصمات تمنع الخلط بين تشغيلين:

- `fault-recovery-report.json`: `0B5526DF78159ADD4D303AF78DB13C0E059350424EA8301ED671A515F64B8506`
- `topology-pdf-load-report.json`: `B26E2BC20C891ACB2225F8CB503B819A2D64CF9EE16BD5F4923A8A8310CEF03C`

## حدود الدليل

- الخدمات المستخدمة محلية production-shaped وليست providers مستضافة.
- لا يثبت الاختبار TLS/PITR لخدمة PostgreSQL مُدارة أو سياسات bucket لدى مزود خارجي.
- لا يثبت rollback/restore ضد staging مستضاف.
- OCR الإقليمي ما زال معطلًا حتى تحديث sealed holdout.
