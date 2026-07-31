# دليل الطوبولوجيا الإنتاجية المحلية — 2026-07-30

## النتيجة

نجحت بوابة الطوبولوجيا الإنتاجية الكاملة أربع مرات بعد إصلاح العيوب التي
كشفها البناء والتشغيل داخل Linux؛ الرابعة كانت دورة موحدة بعد إدخال معالجة
OCR التكيفية واعتماد `sharp`، من البناء حتى التنظيف.

```text
Production topology verified: replicas, Redis, Mailpit, S3, workers,
restart, export, and signed Stripe webhook.
```

## النطاق المثبت

- PostgreSQL 17 و20 ترحيلًا مطبقًا.
- Redis مشترك بين نسختي API وإثبات قفل الحساب عبر النسختين.
- MinIO مع Versioning مفعّل.
- Mailpit ووصول رسالة استعادة كلمة المرور.
- نسختا API بحالة Healthy.
- عمال media/document/export بحالة Healthy.
- رفع PNG حقيقي والتحقق من SHA-256.
- معالجة عبر العامل وإعادة تشغيل API وعامل media.
- إيقاف عامل export، إنشاء المهمة، إعادة تشغيل العامل، إتمام PSD وتنزيله.
- Stripe webhook موقّع، يعالج مرة واحدة ويثبت replay كنسخة مكررة.
- heartbeats وqueue age وduration histogram وdependency readiness.

## أدلة الحالة الحية

```text
runtime image:
sha256:88054902cfbae4e202113aa946b317a7c008cb25818d7d630ad7299413881cfa

runtime identity:
uid=1000(node) gid=1000(node) groups=1000(node)

database:
migrations=20
ready_exports=4
paid_webhook_audits=3

object storage:
local/motionprep-integration versioning is enabled

metrics:
motionprep_dependencies_ready 1 = present
motionprep_worker_up = present
motionprep_queue_oldest_queued_seconds = present
motionprep_job_duration_seconds_bucket = present
```

## عيوب اكتشفت وأصلحت أثناء الإثبات

1. كان `Dockerfile` لا ينسخ `tsconfig.node.json` الجذري؛ فشل بناء workspaces
   داخل Linux رغم نجاح Windows. أضيف الملف وبوابة ساكنة تمنع رجوع العيب.
2. كان فحص readiness ينهي الاختبار عند `ECONNRESET` الانتقالي أثناء restart؛
   أصبح يعيد المحاولة مع إبقاء أخطاء العمل الفعلية قاتلة.
3. قارنت جملة تحقق Stripe بين `text` و`uuid` بلا cast في PostgreSQL.
4. استخدمت أداة الاختبار معرف اشتراك Stripe ثابتًا، فلم تكن قابلة لإعادة
   التشغيل؛ أصبحت جميع مراجع المزود فريدة لكل رحلة.

في مسار Windows ذي الأحرف العربية استُخدم builder التقليدي مؤقتًا بسبب عيب
Compose Bake في ترويسة gRPC. هذا لا يغير محتوى الصورة، وCI يعمل في مسار ASCII.

أعيدت البوابة من حالة نظيفة عبر الأمر الموحد التالي، ونجح البناء والرحلة
والتنظيف التلقائي في 309.8 ثانية:

```text
npm run test:topology:full
```
