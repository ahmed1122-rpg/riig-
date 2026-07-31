import { useEffect, useId, useMemo, useState, type FormEvent } from "react";
import { Icon } from "../../shared/Icon";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isStrongPassword,
} from "@motionprep/contracts";
import { PasswordRequirements } from "./PasswordRequirements";
import {
  ApiError,
  completeMfaLogin,
  confirmPasswordReset,
  login,
  register,
  requestPasswordReset,
} from "../../lib/api";

type AuthScreen = "login" | "register" | "forgot" | "reset" | "mfa" | "verified";
type SubmitState = "idle" | "loading" | "error" | "locked" | "rate_limited";

interface AuthGatewayProps {
  onAuthenticated: () => void;
  onBack: () => void;
}

function AuthField({
  label,
  type = "text",
  value,
  onChange,
  autoComplete,
  placeholder,
  trailing,
  invalid = false,
  describedBy,
  minLength,
  maxLength,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  trailing?: React.ReactNode;
  invalid?: boolean;
  describedBy?: string;
  minLength?: number;
  maxLength?: number;
}) {
  const inputId = useId();
  return (
    <label className="auth-field" htmlFor={inputId}>
      <span>{label}</span>
      <span className="auth-input">
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          minLength={minLength}
          maxLength={maxLength}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          required
        />
        {trailing}
      </span>
    </label>
  );
}

function SecurityNotice() {
  return (
    <div className="auth-demo-note" role="note">
      <Icon name="info" size={16} />
      <span><strong>اتصال آمن بالخادم</strong> تُحفظ الجلسة في Cookie محمية ولا تُخزن الرموز داخل المتصفح.</span>
    </div>
  );
}

function RateLimitedMessage({ state }: { state: SubmitState }) {
  if (state !== "rate_limited") return null;
  return (
    <div className="form-message is-warning" role="alert">
      تم إرسال محاولات كثيرة من هذا الاتصال. انتظر قليلًا ثم أعد المحاولة.
    </div>
  );
}

function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

export default function AuthGateway({ onAuthenticated, onBack }: AuthGatewayProps) {
  const initialResetToken = new URLSearchParams(window.location.search).get("token");
  const [screen, setScreen] = useState<AuthScreen>(initialResetToken ? "reset" : "login");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [consent, setConsent] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [seconds, setSeconds] = useState(42);
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null);

  useEffect(() => {
    if (screen !== "mfa" || seconds <= 0) return;
    const timeout = window.setTimeout(
      () => setSeconds((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => window.clearTimeout(timeout);
  }, [screen, seconds]);

  const title = useMemo(() => ({
    login: "مرحبًا بعودتك",
    register: "أنشئ مساحة إنتاجك",
    forgot: "استعادة الوصول",
    reset: "تعيين كلمة مرور جديدة",
    mfa: "تحقق بخطوة إضافية",
    verified: "تحقق من بريدك",
  })[screen], [screen]);

  const resetSubmit = (next: AuthScreen) => {
    setSubmitState("idle");
    setScreen(next);
  };

  const handleLogin = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitState("loading");
    try {
      const result = await login(email, password);
      if (result.kind === "mfa_required") {
        setMfaChallengeToken(result.challengeToken);
        setMfaCode("");
        setSeconds(
          Math.max(
            0,
            Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000),
          ),
        );
        setSubmitState("idle");
        setScreen("mfa");
        return;
      }
      setSubmitState("idle");
      onAuthenticated();
    } catch (error) {
      setSubmitState(
        isRateLimited(error)
          ? "rate_limited"
          : error instanceof ApiError && error.code === "ACCOUNT_LOCKED"
          ? "locked"
          : "error",
      );
    }
  };

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault();
    if (!consent || !isStrongPassword(password)) {
      setSubmitState("error");
      return;
    }
    setSubmitState("loading");
    try {
      await register(name, email, password);
      setSubmitState("idle");
      onAuthenticated();
    } catch (error) {
      setSubmitState(isRateLimited(error) ? "rate_limited" : "error");
    }
  };

  const handleMfa = async (event: FormEvent) => {
    event.preventDefault();
    const valid = recoveryMode ? mfaCode.trim().length >= 8 : /^\d{6}$/.test(mfaCode);
    if (!valid) {
      setSubmitState("error");
      return;
    }
    setSubmitState("loading");
    try {
      if (!mfaChallengeToken) throw new Error("Missing MFA challenge.");
      await completeMfaLogin(mfaChallengeToken, mfaCode);
      setSubmitState("idle");
      onAuthenticated();
    } catch (error) {
      setSubmitState(isRateLimited(error) ? "rate_limited" : "error");
    }
  };

  const handleForgot = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitState("loading");
    try {
      await requestPasswordReset(email);
      setSubmitState("idle");
      setScreen("verified");
    } catch (error) {
      setSubmitState(isRateLimited(error) ? "rate_limited" : "error");
    }
  };

  const handleReset = async (event: FormEvent) => {
    event.preventDefault();
    if (!initialResetToken || !isStrongPassword(password)) {
      setSubmitState("error");
      return;
    }
    setSubmitState("loading");
    try {
      await confirmPasswordReset(initialResetToken, password);
      window.history.replaceState({}, "", window.location.pathname);
      setPassword("");
      setSubmitState("idle");
      setScreen("login");
    } catch (error) {
      setSubmitState(isRateLimited(error) ? "rate_limited" : "error");
    }
  };

  return (
    <main className="auth-gateway" dir="rtl">
      <section className="auth-panel" aria-labelledby="auth-title">
        <header className="auth-brand">
          <span className="brand-mark"><Icon name="layers" size={20} /></span>
          <span><strong>MotionPrep</strong><small>بوابة الوصول الآمن</small></span>
          <button type="button" className="text-button auth-back" onClick={onBack}>
            العودة إلى الاستوديو <Icon name="arrow" size={14} />
          </button>
        </header>

        <div className="auth-form-wrap">
          <span className="eyebrow">حسابك ومساحة إنتاجك</span>
          <h1 id="auth-title">{title}</h1>
          <p className="auth-subtitle">
            {screen === "mfa"
              ? "أدخل رمز تطبيق المصادقة أو أحد رموز الاسترداد."
              : "وصول واضح وآمن إلى مشاريعك وملفات التصدير دون تعقيد."}
          </p>

          {screen === "login" && (
            <form className="auth-form" onSubmit={handleLogin}>
              <AuthField label="البريد الإلكتروني" type="email" value={email} onChange={setEmail} autoComplete="email" invalid={submitState === "error"} describedBy="login-error" />
              <AuthField
                label="كلمة المرور"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                invalid={submitState === "error"}
                describedBy="login-error"
                trailing={
                  <button type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}>
                    <Icon name={showPassword ? "eyeOff" : "eye"} size={17} />
                  </button>
                }
              />
              <div className="auth-form-row">
                <button type="button" className="text-link" onClick={() => resetSubmit("forgot")}>نسيت كلمة المرور؟</button>
              </div>
              <p className="auth-helper"><Icon name="shield" size={14} /> الجلسة محفوظة في Cookie محمية وقابلة للإلغاء من الخادم.</p>
              {submitState === "error" && <div id="login-error" className="form-message is-error" role="alert">تعذر تسجيل الدخول. راجع البريد وكلمة المرور ثم حاول مرة أخرى.</div>}
              {submitState === "locked" && <div className="form-message is-warning" role="alert">تم إيقاف المحاولات مؤقتًا لحماية الحساب. حاول بعد 12 دقيقة أو استعد الوصول.</div>}
              <RateLimitedMessage state={submitState} />
              <button className="primary-button auth-submit" type="submit" disabled={submitState === "loading"}>
                {submitState === "loading" ? <><i className="button-spinner" /> جارٍ التحقق…</> : <>متابعة آمنة <Icon name="login" size={17} /></>}
              </button>
              <p className="auth-switch">ليس لديك حساب؟ <button type="button" onClick={() => resetSubmit("register")}>إنشاء حساب</button></p>
            </form>
          )}

          {screen === "register" && (
            <form className="auth-form" onSubmit={handleRegister}>
              <AuthField label="الاسم" value={name} onChange={setName} autoComplete="name" placeholder="الاسم الظاهر داخل الاستوديو" invalid={submitState === "error"} describedBy="register-error" />
              <AuthField label="البريد الإلكتروني" type="email" value={email} onChange={setEmail} autoComplete="email" invalid={submitState === "error"} describedBy="register-error" />
              <AuthField
                label="كلمة المرور"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                invalid={submitState === "error"}
                describedBy="register-password-requirements register-error"
                minLength={PASSWORD_MIN_LENGTH}
                maxLength={PASSWORD_MAX_LENGTH}
                trailing={<button type="button" onClick={() => setShowPassword((value) => !value)} aria-label="تبديل إظهار كلمة المرور"><Icon name={showPassword ? "eyeOff" : "eye"} size={17} /></button>}
              />
              <PasswordRequirements password={password} id="register-password-requirements" />
              <label className="check-label auth-consent">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span>أوافق على شروط الاستخدام وسياسة الخصوصية.</span>
              </label>
              {submitState === "error" && <div id="register-error" className="form-message is-error" role="alert">أكمل البيانات والموافقة، واستخدم كلمة مرور من 10 أحرف على الأقل.</div>}
              <RateLimitedMessage state={submitState} />
              <button className="primary-button auth-submit" type="submit" disabled={submitState === "loading" || !consent || !isStrongPassword(password)}>
                {submitState === "loading" ? "جارٍ إعداد الحساب…" : "إنشاء الحساب"}
              </button>
              <p className="auth-switch">لديك حساب بالفعل؟ <button type="button" onClick={() => resetSubmit("login")}>تسجيل الدخول</button></p>
            </form>
          )}

          {screen === "forgot" && (
            <form className="auth-form" onSubmit={handleForgot}>
              <AuthField label="البريد المرتبط بالحساب" type="email" value={email} onChange={setEmail} autoComplete="email" invalid={submitState === "error"} describedBy="forgot-error" />
              <p className="auth-helper"><Icon name="mail" size={14} /> سنرسل رابطًا قصير العمر. لن نكشف إن كان البريد مسجلًا أم لا.</p>
              {submitState === "error" && <div id="forgot-error" className="form-message is-error" role="alert">تعذر إرسال الطلب الآن. حاول مرة أخرى لاحقًا.</div>}
              <RateLimitedMessage state={submitState} />
              <button className="primary-button auth-submit" type="submit" disabled={submitState === "loading"}>{submitState === "loading" ? "جارٍ إرسال الطلب…" : "إرسال رابط الاستعادة"}</button>
              <button className="secondary-button auth-submit" type="button" onClick={() => resetSubmit("login")}>العودة لتسجيل الدخول</button>
            </form>
          )}

          {screen === "reset" && (
            <form className="auth-form" onSubmit={handleReset}>
              <div className="form-message is-success" role="status">عيّن كلمة مرور جديدة. سيُلغى الرابط وكل الجلسات السابقة بعد الحفظ.</div>
              <AuthField label="كلمة المرور الجديدة" type="password" value={password} onChange={setPassword} autoComplete="new-password" invalid={submitState === "error"} describedBy="reset-password-requirements reset-error" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} />
              <PasswordRequirements password={password} id="reset-password-requirements" />
              {submitState === "error" && <div id="reset-error" className="form-message is-error" role="alert">الرابط منتهي أو كلمة المرور لا تحقق المتطلبات.</div>}
              <RateLimitedMessage state={submitState} />
              <button className="primary-button auth-submit" type="submit" disabled={submitState === "loading" || !isStrongPassword(password)}>{submitState === "loading" ? "جارٍ الحفظ…" : "حفظ والعودة للدخول"}</button>
            </form>
          )}

          {screen === "mfa" && (
            <form className="auth-form" onSubmit={handleMfa}>
              <label className="auth-field">
                <span>{recoveryMode ? "رمز الاسترداد" : "رمز التحقق المكوّن من 6 أرقام"}</span>
                <input
                  className={recoveryMode ? "recovery-input" : "mfa-input"}
                  value={mfaCode}
                  onChange={(event) => setMfaCode(recoveryMode ? event.target.value : event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode={recoveryMode ? "text" : "numeric"}
                  autoComplete="one-time-code"
                  placeholder={recoveryMode ? "MP-XXXX-XXXX" : "••••••"}
                  aria-label={recoveryMode ? "رمز الاسترداد" : "رمز التحقق"}
                  aria-invalid={submitState === "error" || undefined}
                  aria-describedby={submitState === "error" ? "mfa-error" : undefined}
                  autoFocus
                />
              </label>
              {submitState === "error" && <div id="mfa-error" className="form-message is-error" role="alert">أدخل {recoveryMode ? "رمز استرداد صالحًا" : "ستة أرقام"} للمتابعة.</div>}
              <RateLimitedMessage state={submitState} />
              <button className="primary-button auth-submit" type="submit" disabled={submitState === "loading"}>
                {submitState === "loading" ? "جارٍ فتح الجلسة…" : "تحقق وادخل"}
              </button>
              <div className="auth-form-row auth-mfa-actions">
                <button type="button" className="text-link" onClick={() => { setRecoveryMode((value) => !value); setMfaCode(""); setSubmitState("idle"); }}>
                  {recoveryMode ? "استخدام رمز التحقق" : "استخدام رمز استرداد"}
                </button>
                <span className="auth-helper">{seconds > 0 ? `تنتهي المحاولة خلال ${seconds} ث` : "انتهت المحاولة؛ أعد تسجيل الدخول."}</span>
              </div>
            </form>
          )}

          {screen === "verified" && (
            <div className="auth-success">
              <span><Icon name="mail" size={28} /></span>
              <h2>تحقق من بريدك</h2>
              <p>إذا كان <bdi>{email}</bdi> مرتبطًا بحساب نشط فسيصل رابط صالح لمدة 30 دقيقة.</p>
              <button type="button" className="primary-button auth-submit" onClick={() => resetSubmit("login")}>العودة لتسجيل الدخول</button>
            </div>
          )}

          <SecurityNotice />
        </div>
      </section>

      <aside className="auth-context" aria-label="معلومات الأمان والإنتاج">
        <img
          className="auth-context__presenter"
          src="/visuals/presenter-auth.webp"
          width="960"
          height="1440"
          alt=""
          aria-hidden="true"
          decoding="async"
        />
        <div className="auth-context__top">
          <span className="demo-badge"><i /> SECURE ACCESS</span>
          <span>SESSION GATEWAY</span>
        </div>
        <div className="auth-context__copy">
          <span className="auth-context__index">01 — ACCESS</span>
          <h2>ملفاتك الإبداعية<br />تبقى تحت سيطرتك.</h2>
          <p>جلسات قصيرة، أجهزة يمكن إلغاؤها، وسجل واضح لكل دخول حساس.</p>
        </div>
        <ol className="auth-trace">
          <li className="is-active"><Icon name="shieldCheck" size={17} /><span><strong>اتصال محمي</strong><small>TLS + secure cookies</small></span></li>
          <li><Icon name="smartphone" size={17} /><span><strong>جهاز موثوق</strong><small>قابل للإلغاء في أي وقت</small></span></li>
          <li><Icon name="history" size={17} /><span><strong>تتبّع الجلسة</strong><small>آخر نشاط وموقع تقريبي</small></span></li>
        </ol>
        <footer><Icon name="key" size={16} /> لن نطلب كلمة مرورك عبر البريد أو الدعم.</footer>
      </aside>
    </main>
  );
}
