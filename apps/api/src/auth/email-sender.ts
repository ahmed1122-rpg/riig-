export interface PasswordResetMessage {
  recipient: string;
  resetUrl: string;
  expiresAt: string;
}

export interface EmailVerificationMessage {
  recipient: string;
  verificationUrl: string;
  expiresAt: string;
}

export type EmailDeliveryMessage =
  | { kind: "password-reset"; message: PasswordResetMessage }
  | { kind: "email-verification"; message: EmailVerificationMessage };

export interface EmailSender {
  sendPasswordReset(message: PasswordResetMessage): Promise<void>;
  sendEmailVerification?(message: EmailVerificationMessage): Promise<void>;
}

export class InMemoryEmailSender implements EmailSender {
  readonly passwordResets: PasswordResetMessage[] = [];
  readonly emailVerifications: EmailVerificationMessage[] = [];

  async sendPasswordReset(message: PasswordResetMessage): Promise<void> {
    this.passwordResets.push(message);
  }

  async sendEmailVerification(message: EmailVerificationMessage): Promise<void> {
    this.emailVerifications.push(message);
  }
}
