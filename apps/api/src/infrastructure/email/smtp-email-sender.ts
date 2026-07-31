import nodemailer from "nodemailer";
import type {
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
    await this.#transport.sendMail({
      from: this.options.from,
      to: message.recipient,
      subject: "إعادة تعيين كلمة مرور MotionPrep",
      text: [
        "وصلنا طلب لإعادة تعيين كلمة مرور حسابك في MotionPrep.",
        "",
        `افتح الرابط التالي قبل ${message.expiresAt}:`,
        message.resetUrl,
        "",
        "إذا لم تطلب ذلك فتجاهل الرسالة، وستظل كلمة مرورك كما هي.",
      ].join("\n"),
    });
  }
}
