# دليل إصدار GHCR الموقّع v0.1.0

**التاريخ:** 2026-07-31

## النتيجة

نُشر الإصدار `v0.1.0` من Git SHA `48bdfd9b53b0c955a93f5a121660ea9b3e546df4` إلى GHCR بعد نجاح بوابات GitHub المستضافة.

| المكوّن | المرجع غير القابل للتغيير |
|---|---|
| Runtime | `ghcr.io/ahmed1122-rpg/motionprep-runtime@sha256:276440bbf1162f62027a8e531fe645be73ce6e3d7d77b6abae22f9c30b086b5d` |
| Web | `ghcr.io/ahmed1122-rpg/motionprep-web@sha256:b9ae25b8cbbc0a9ed9484b0b8c8e691b470a7dc54d7860cbd86e5a1a5f37b14f` |

## الأدلة

- نجحت دورة `quality` المستضافة بكل وظائفها: secret scan، validate، PostgreSQL/S3 durable integration، production topology، Playwright E2E، container build/scan، وrelease fixtures.
- نجح CodeQL على SHA الإصدار.
- بُنيت الصورتان مع BuildKit SBOM وprovenance ونُشرتا بالـdigest.
- نجح smoke لصورة Web المنشورة مع مستخدم غير جذري، read-only، `cap-drop ALL`، و`no-new-privileges`.
- نجح Trivy للصورتين قبل التوقيع دون High/Critical غير محلولة.
- وُقّع الـdigestان بتوقيع Cosign keyless من GitHub OIDC، ثم أُعيد التحقق منهما محليًا بصورة مستقلة.
- هوية الشهادة: `https://github.com/ahmed1122-rpg/riig-/.github/workflows/release-images.yml@refs/tags/v0.1.0`.
- جهة الإصدار: `https://token.actions.githubusercontent.com`، مع إثبات inclusion في Sigstore transparency log.

## روابط التشغيل

- Quality: `https://github.com/ahmed1122-rpg/riig-/actions/runs/30638566045`
- CodeQL: `https://github.com/ahmed1122-rpg/riig-/actions/runs/30638566238`
- Signed release: `https://github.com/ahmed1122-rpg/riig-/actions/runs/30638870985`

هذا الدليل يغلق النشر والتوقيع في سجل المزود، لكنه لا يثبت بعد نشر staging أو rollback أو S3 الإنتاجي أو تمرين الاستعادة.
