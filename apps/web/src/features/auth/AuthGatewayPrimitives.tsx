import { useId } from "react";
import { Icon } from "../../shared/Icon";
import { ApiError } from "../../lib/api";

export type AuthScreen =
  | "login"
  | "register"
  | "forgot"
  | "reset"
  | "mfa"
  | "verified"
  | "email_sent"
  | "verifying";
export type SubmitState = "idle" | "loading" | "error" | "locked" | "rate_limited";
export type MfaFailure = "invalid" | "expired" | "server" | null;

export function AuthField({
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

export function SecurityNotice() {
  return (
    <div className="auth-demo-note" role="note">
      <Icon name="info" size={16} />
      <span><strong>اتصال آمن بالخادم</strong> تُحفظ الجلسة في Cookie محمية ولا تُخزن الرموز داخل المتصفح.</span>
    </div>
  );
}

export function RateLimitedMessage({ state }: { state: SubmitState }) {
  if (state !== "rate_limited") return null;
  return (
    <div className="form-message is-warning" role="alert">
      تم إرسال محاولات كثيرة من هذا الاتصال. انتظر قليلًا ثم أعد المحاولة.
    </div>
  );
}

export function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === 429;
}

export function classifyMfaFailure(error: unknown): Exclude<MfaFailure, null> {
  if (error instanceof ApiError && error.code === "MFA_CODE_INVALID") {
    return "invalid";
  }
  if (error instanceof ApiError && error.code === "MFA_CHALLENGE_INVALID") {
    return "expired";
  }
  return "server";
}
