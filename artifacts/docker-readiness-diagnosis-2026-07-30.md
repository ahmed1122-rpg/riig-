# تشخيص بوابة Docker — 2026-07-30

## النتيجة

**الحالة: حُلّت في 2026-07-30.** فعّل المستخدم الافتراضية وVirtual Machine
Platform وأعاد التشغيل. أصبح `HypervisorPresent=True`، وبدأ Docker Desktop
بنجاح، واستجاب Linux Engine بالإصدار 29.6.2.

## الأدلة

بعد إذن المستخدم، نُفذ:

```text
docker desktop start
```

ظل الأمر ينتظر أكثر من دقيقة، ثم بقيت الحالة:

```text
Status: stopped
```

أظهر سجل Docker:

```text
WSL2 is unable to start since virtualization is not enabled on this machine.
HCS_E_HYPERV_NOT_INSTALLED
```

وأظهر فحص Windows:

```text
VirtualizationFirmwareEnabled : False
VMMonitorModeExtensions       : True
SecondLevelAddressTranslationExtensions : True
HypervisorPresent             : False
```

المعالج يدعم المتطلبات، لكنها غير مفعلة. لا يوجد Docker context بعيد، ولا
Git remote أو commit baseline يمكن تشغيل CI عليه بدلًا من هذه الآلة.

## الإجراء الذي نفذه مالك الجهاز

1. حفظ العمل وإعادة التشغيل إلى إعدادات UEFI/BIOS.
2. تفعيل `Intel Virtualization Technology` أو `VT-x` (قد يسمى
   `Virtualization` فقط).
3. بعد العودة إلى Windows، فتح PowerShell **كمسؤول** وتنفيذ:

   ```powershell
   wsl.exe --install --no-distribution
   ```

4. إعادة التشغيل إذا طلب Windows ذلك.
5. تشغيل Docker Desktop وانتظار ظهور حالة `running`.

بعد ذلك نجحت أوامر إثبات البوابة، بما فيها:

```powershell
docker desktop status
docker version
npm run test:topology
```

لا يُعد نجاح `docker compose config` بديلًا عن اختبار الطوبولوجيا الفعلي.
وقد نُفذ الاختبار الفعلي بنجاح مرتين.
