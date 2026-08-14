import nodemailer from "nodemailer";
import type {
  EmailVerificationMessage,
  EmailSender,
  PasswordResetMessage,
} from "../../auth/email-sender.js";

export interface SmtpEmailOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTls: boolean;
  user: string;
  password: string;
  from: string;
}

export class SmtpEmailSender implements EmailSender {
  readonly #transport;
  #lastVerifiedAt = 0;
  #verification: Promise<void> | null = null;

  constructor(private readonly options: SmtpEmailOptions) {
    this.#transport = nodemailer.createTransport({
      host: options.host,
      port: options.port,
      secure: options.secure,
      requireTLS: options.requireTls,
      auth: {
        user: options.user,
        pass: options.password,
      },
      disableFileAccess: true,
      disableUrlAccess: true,
      connectionTimeout: 5_000,
      greetingTimeout: 5_000,
      socketTimeout: 5_000,
    });
  }

  async ready(): Promise<void> {
    if (Date.now() - this.#lastVerifiedAt < 60_000) return;
    if (!this.#verification) {
      this.#verification = this.#transport
        .verify()
        .then(() => {
          this.#lastVerifiedAt = Date.now();
        })
        .finally(() => {
          this.#verification = null;
        });
    }
    await this.#verification;
  }

  close(): void {
    this.#transport.close();
  }

  async sendPasswordReset(message: PasswordResetMessage): Promise<void> {
    const content = passwordResetEmailContent(message);
    await this.#transport.sendMail({
      from: this.options.from,
      to: message.recipient,
      ...content,
    });
  }

  async sendEmailVerification(message: EmailVerificationMessage): Promise<void> {
    const content = emailVerificationContent(message);
    await this.#transport.sendMail({
      from: this.options.from,
      to: message.recipient,
      ...content,
    });
  }
}

function emailVerificationContent(
  message: EmailVerificationMessage,
): { subject: string; text: string; html: string } {
  const verificationUrl = escapeHtml(message.verificationUrl);
  const subject = "تأكيد البريد الإلكتروني في MotionPrep";
  const text = [
    "أكّد بريدك الإلكتروني لإكمال إنشاء حساب MotionPrep.",
    "",
    message.verificationUrl,
    "",
    "إذا لم تنشئ هذا الحساب فتجاهل الرسالة.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="font-family:Arial,sans-serif;line-height:1.7;color:#172033;background:#f5f7fb;padding:24px">
    <main style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:28px">
      <h1 style="font-size:22px;margin-top:0">تأكيد البريد الإلكتروني</h1>
      <p>أكّد بريدك الإلكتروني لإكمال إنشاء حساب MotionPrep.</p>
      <p><a href="${verificationUrl}" style="display:inline-block;background:#2457d6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">تأكيد البريد</a></p>
      <p style="font-size:13px;color:#526079;overflow-wrap:anywhere">${verificationUrl}</p>
      <p>إذا لم تنشئ هذا الحساب فتجاهل الرسالة.</p>
    </main>
  </body>
</html>`;
  return { subject, text, html };
}

export function passwordResetEmailContent(
  message: PasswordResetMessage,
): { subject: string; text: string; html: string } {
  const expiresAt = new Intl.DateTimeFormat("ar-EG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(message.expiresAt));
  const resetUrl = escapeHtml(message.resetUrl);
  const subject = "إعادة تعيين كلمة مرور MotionPrep";
  const text = [
    "وصلنا طلبًا لإعادة تعيين كلمة مرور حسابك في MotionPrep.",
    "",
    `افتح الرابط التالي قبل ${expiresAt} بتوقيت UTC:`,
    message.resetUrl,
    "",
    "إذا لم تطلب ذلك فتجاهل الرسالة، وستظل كلمة مرورك كما هي.",
  ].join("\n");
  const html = `<!doctype html>
<html lang="ar" dir="rtl">
  <body style="font-family:Arial,sans-serif;line-height:1.7;color:#172033;background:#f5f7fb;padding:24px">
    <main style="max-width:560px;margin:auto;background:#fff;border-radius:12px;padding:28px">
      <h1 style="font-size:22px;margin-top:0">إعادة تعيين كلمة المرور</h1>
      <p>وصلنا طلبًا لإعادة تعيين كلمة مرور حسابك في MotionPrep.</p>
      <p>استخدم الزر التالي قبل <strong>${escapeHtml(expiresAt)} بتوقيت UTC</strong>:</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#2457d6;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px">إعادة تعيين كلمة المرور</a></p>
      <p style="font-size:13px;color:#526079;overflow-wrap:anywhere">${resetUrl}</p>
      <p>إذا لم تطلب ذلك فتجاهل الرسالة، وستظل كلمة مرورك كما هي.</p>
    </main>
  </body>
</html>`;
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
