import { useState, type FormEvent } from "react";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isStrongPassword,
} from "@motionprep/contracts";
import {
  ApiError,
  beginMfaSetup,
  changePassword,
  confirmMfaSetup,
  disableMfa,
  logout,
  type SessionUser,
} from "../../lib/api";
import { Icon } from "../../shared/Icon";
import { PasswordRequirements } from "./PasswordRequirements";

interface SessionSecurityProps {
  user: SessionUser | null;
  onOpenAuth: () => void;
  onSessionEnded: () => void;
  onNotify: (message: string) => void;
}

type MfaSetup = Awaited<ReturnType<typeof beginMfaSetup>>;

export default function SessionSecurity({
  user,
  onOpenAuth,
  onSessionEnded,
  onNotify,
}: SessionSecurityProps) {
  const [setup, setSetup] = useState<MfaSetup | null>(null);
  const [setupCode, setSetupCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [disablePassword, setDisablePassword] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <section className="security-page page-enter">
        <div className="admin-empty">
          <Icon name="shield" size={28} />
          <strong>سجّل الدخول لإدارة أمان الحساب</strong>
          <button type="button" className="primary-button" onClick={onOpenAuth}>تسجيل الدخول</button>
        </div>
      </section>
    );
  }

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await operation();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "تعذر تنفيذ إجراء الأمان.",
      );
    } finally {
      setBusy(false);
    }
  };

  const startMfa = () =>
    run(async () => {
      setSetup(await beginMfaSetup());
      setSetupCode("");
    });

  const confirmMfa = (event: FormEvent) => {
    event.preventDefault();
    if (!setup) return;
    void run(async () => {
      const result = await confirmMfaSetup(setup.setupToken, setupCode);
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      onNotify("تم تفعيل المصادقة الثنائية وإبطال الجلسات السابقة.");
    });
  };

  const turnOffMfa = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await disableMfa(disablePassword, disableCode);
      onSessionEnded();
      onNotify("تم إيقاف المصادقة الثنائية. سجّل الدخول مجدّدًا.");
      onOpenAuth();
    });
  };

  const updatePassword = (event: FormEvent) => {
    event.preventDefault();
    if (!isStrongPassword(newPassword)) return;
    void run(async () => {
      await changePassword(currentPassword, newPassword);
      onSessionEnded();
      onNotify("تم تغيير كلمة المرور وإبطال جميع الجلسات.");
      onOpenAuth();
    });
  };

  const endSession = () =>
    run(async () => {
      await logout();
      onSessionEnded();
      onNotify("تم تسجيل الخروج من الجلسة الحالية.");
    });

  const downloadRecoveryCodes = () => {
    const url = URL.createObjectURL(
      new Blob([recoveryCodes.join("\n")], { type: "text/plain;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "motionprep-recovery-codes.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (recoveryCodes.length > 0) {
    return (
      <section className="security-page page-enter">
        <header className="feature-page-header"><div><span className="eyebrow">خطوة أخيرة</span><h1>احفظ رموز الاسترداد</h1><p>تظهر هذه الرموز مرة واحدة فقط. كل رمز صالح لاستخدام واحد.</p></div></header>
        <article className="security-primary recovery-panel">
          <div className="recovery-code-grid">{recoveryCodes.map((code) => <code key={code}>{code}</code>)}</div>
          <div className="security-actions"><button type="button" className="secondary-button" onClick={downloadRecoveryCodes}><Icon name="download" size={16} /> تنزيل الرموز</button><button type="button" className="primary-button" onClick={() => { onSessionEnded(); onOpenAuth(); }}>حفظت الرموز — تسجيل الدخول مجدّدًا</button></div>
        </article>
      </section>
    );
  }

  return (
    <section className="security-page page-enter">
      <header className="feature-page-header">
        <div>
          <span className="eyebrow">الحساب والأمان</span>
          <h1>إعدادات الوصول</h1>
          <p>إجراءات فعلية من الخادم؛ التغييرات الحساسة تبطل الجلسات وتطلب دخولًا جديدًا.</p>
        </div>
        <button type="button" className="danger-button" disabled={busy} onClick={() => void endSession()}><Icon name="logout" size={16} /> تسجيل الخروج</button>
      </header>

      {error && <div className="form-message is-error" role="alert">{error}</div>}

      <div className="security-layout">
        <article className="security-primary">
          <header><div><Icon name="key" size={19} /><span><strong>المصادقة الثنائية</strong><small>{user.mfaEnabled ? "مفعلة عبر تطبيق TOTP" : "غير مفعلة"}</small></span></div><span className={`status ${user.mfaEnabled ? "status--ready" : "status--review"}`}>{user.mfaEnabled ? "مفعلة" : "موصى بها"}</span></header>

          {!user.mfaEnabled && !setup && (
            <div className="security-form-block">
              <p>أضف تطبيق مصادقة مثل 1Password أو Google Authenticator. بعد التفعيل ستُبطل الجلسات الحالية.</p>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void startMfa()}><Icon name="smartphone" size={16} /> بدء إعداد MFA</button>
            </div>
          )}

          {setup && (
            <form className="security-form-block" onSubmit={confirmMfa}>
              <p>أضف الحساب باستخدام المفتاح التالي، ثم أدخل الرمز المكون من ستة أرقام.</p>
              <code className="mfa-secret" dir="ltr">{setup.secret}</code>
              <button type="button" className="text-link" onClick={() => void navigator.clipboard.writeText(setup.otpAuthUri)}>نسخ رابط تطبيق المصادقة</button>
              <label className="dialog-field">رمز التطبيق<input inputMode="numeric" pattern="\d{6}" maxLength={6} value={setupCode} onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, ""))} required /></label>
              <button type="submit" className="primary-button" disabled={busy || setupCode.length !== 6}>تأكيد وتوليد رموز الاسترداد</button>
            </form>
          )}

          {user.mfaEnabled && (
            <form className="security-form-block" onSubmit={turnOffMfa}>
              <p>إيقاف MFA يحتاج كلمة المرور الحالية ورمز التطبيق أو رمز استرداد.</p>
              <label className="dialog-field">كلمة المرور الحالية<input type="password" autoComplete="current-password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} required /></label>
              <label className="dialog-field">رمز التحقق<input value={disableCode} onChange={(event) => setDisableCode(event.target.value)} required /></label>
              <button type="submit" className="danger-button" disabled={busy || !disablePassword || disableCode.length < 6}>إيقاف المصادقة الثنائية</button>
            </form>
          )}
        </article>

        <aside className="security-side">
          <div className="security-status"><span><Icon name="shieldCheck" size={22} /></span><strong>{user.name}</strong><p>{user.email}</p></div>
          <dl className="security-facts">
            <div><dt>الدور</dt><dd>{user.role}</dd></div>
            <div><dt>المصادقة الثنائية</dt><dd>{user.mfaEnabled ? "مفعلة" : "غير مفعلة"}</dd></div>
            <div><dt>تخزين الجلسة</dt><dd className="success-text">HttpOnly Cookie</dd></div>
          </dl>
        </aside>
      </div>

      <article className="security-primary password-change-panel">
        <header><div><Icon name="lock" size={19} /><span><strong>تغيير كلمة المرور</strong><small>يبطل جميع الجلسات وروابط الاستعادة السابقة</small></span></div></header>
        <form className="security-form-block security-password-form" onSubmit={updatePassword}>
          <label className="dialog-field">كلمة المرور الحالية<input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
          <label className="dialog-field">كلمة المرور الجديدة<input type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} aria-describedby="change-password-requirements" required /></label>
          <PasswordRequirements password={newPassword} id="change-password-requirements" />
          <button type="submit" className="primary-button" disabled={busy || !currentPassword || !isStrongPassword(newPassword)}>تغيير كلمة المرور</button>
        </form>
      </article>
    </section>
  );
}
