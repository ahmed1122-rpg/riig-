# بوابة Adobe Golden

تولد هذه البوابة ملفي PSD ثابتين لاختبار التوافق الفعلي مع Photoshop وAfter
Effects من دون الاعتماد على ملفات يدوية متغيرة.

```bash
npm run golden:adobe:generate
```

يبني الأمر مرحلة Docker المثبتة `adobe-golden-generator` ثم يكتب الملفات في
`generated/` ويحدّث `manifest.json`. لا تعتمد البصمات على مكتبات الخطوط في
نظام المضيف. يفحص `npm run verify:adobe-golden` الحجم والبصمة والأبعاد ونمط
RGB/8 وترتيب الطبقات، كما يعيد بناء صورة الإنتاج الملفات ويقارن البايتات
قبل نجاح البناء. تظل الموافقة النهائية مشروطة بفتح الملفات في إصدارات Adobe
المستهدفة.

## قائمة التحقق

### Photoshop 2026

1. افتح `generated/image-layers.psd`.
2. تحقق من RGB/8، ومقاس 640×360، ووجود `+البطاقة` فوق `+الخلفية`.
3. تحقق من عتامة البطاقة 72% ومن بقاء الخلفية مقفلة.
4. افتح `generated/book-pages.psd`.
5. تحقق من مقاس 640×720 ومن مجموعتي `+page_001` و`+page_002`.

### After Effects 2026

1. استورد كل ملف بوضع `Composition - Retain Layer Sizes`.
2. تحقق من ظهور Composition من دون تحذير parsing أو طبقات مفقودة.
3. تحقق من ترتيب الطبقات، وأبعادها، والشفافية، وتطابق معاينة كل ملف مع
   Photoshop.

دوّن كل تشغيل في `report.md` مع نسخة التطبيق ونظام التشغيل والنتيجة. عند
الفشل، احتفظ بالملف وبصمته ولا تعِد توليده قبل تشخيص الانحدار.

يمكن تشغيل فحص After Effects الآلي من Windows بعد فتح التطبيق المرخّص:

```powershell
& 'C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.exe' `
  -r (Resolve-Path 'scripts/adobe/verify-after-effects.jsx')
```

يستورد السكربت الملفين كـ `Composition - Retain Layer Sizes`، يحفظ معاينتي
PNG مؤقتتين في `generated/`، يسجل النتيجة في `after-effects-result.txt`، ثم
يحذف كل عناصر الاستيراد من المشروع المفتوح. ملفات المعاينة المؤقتة مستبعدة
من Git. أحدث أدلة التطبيقين موجودة في `photoshop-result.txt` و
`after-effects-result.txt`.
