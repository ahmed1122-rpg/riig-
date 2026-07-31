# دليل الإصدار المحلي الموقّع 0a2103a

**التاريخ:** 2026-07-31
**حالة الدليل:** مكتمل محليًا؛ ليس اعتماد إنتاج سحابي.

## النتيجة

بُنيت صورتا `runtime` و`web` من المصدر عند Git SHA الكامل `0a2103addf1c71ed6402d955a9a59d8da0d17485`، ونُشرتا في سجل OCI محلي على `localhost:5000` بمراجع غير قابلة للتغيير. يحتوي كل image index على SBOM وprovenance من BuildKit.

| المكوّن | المرجع المثبّت |
|---|---|
| Runtime | `localhost:5000/motionprep-runtime@sha256:1daeff9e92a8c76553e1e29a97e561547cc7933d504fde15c347be859586c757` |
| Web | `localhost:5000/motionprep-web@sha256:6aa68db109366280864392ade512a0b70ea4fe0069100ed20e4114283c60a619` |

## بوابات القبول

- Trivy 0.72.0: صفر ثغرات `HIGH` أو `CRITICAL` غير محلولة في الصورتين عند فحص الـdigests المنشورة.
- مستخدم Runtime هو `node`، ومستخدم Web هو `nginx`.
- نجح Web health smoke من المرجع المنشور مع `read-only` و`cap-drop ALL` و`no-new-privileges`.
- وُقّع كل digest بتوقيع Cosign 3.1.2 واحد مع annotations للمكوّن و`source-git-sha=0a2103a`.
- أُعيد التحقق من التوقيعين بالمفتاح العام المحفوظ في `motionprep-release.pub`.
- حُذف المفتاح الخاص بعد التوقيع، ولم يُحفظ داخل المستودع أو مجلد الأدلة.

## حدود هذا الدليل

السجل يعمل محليًا عبر HTTP، والتوقيعات لم تُرفع إلى transparency log. لذلك يثبت هذا الملف سلامة مسار البناء والفحص والتوقيع المحلي، لكنه لا يستبدل GHCR أو سجلًا محميًا، أو هوية OIDC، أو توقيعًا keyless قابلًا للتدقيق العام، أو اختبار staging/rollback.

لإعادة التحقق من داخل Docker، استخدم صورة Cosign المثبتة بالـdigest، واربط هذا المجلد إلى `/workspace`، واستخدم `--allow-http-registry --insecure-ignore-tlog --key /workspace/motionprep-release.pub` مع قيم `RUNTIME_COSIGN_REF` و`WEB_COSIGN_REF` في `release-0a2103a.env`.
