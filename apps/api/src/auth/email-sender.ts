export interface PasswordResetMessage {
  recipient: string;
  resetUrl: string;
  expiresAt: string;
}

export interface EmailSender {
  sendPasswordReset(message: PasswordResetMessage): Promise<void>;
}

export class InMemoryEmailSender implements EmailSender {
  readonly passwordResets: PasswordResetMessage[] = [];

  async sendPasswordReset(message: PasswordResetMessage): Promise<void> {
    this.passwordResets.push(message);
  }
}
