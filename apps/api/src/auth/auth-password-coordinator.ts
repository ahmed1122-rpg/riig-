import { hashPassword, verifyPassword } from "./password.js";
import type { AuthRepository, UserRecord } from "./auth-repository.js";
import type { EmailSender } from "./email-sender.js";

type PasswordErrorCode =
  | "PASSWORD_RESET_INVALID"
  | "CURRENT_PASSWORD_INVALID";

interface AuthPasswordCoordinatorOptions {
  repository: AuthRepository;
  now: () => Date;
  emailSender: EmailSender;
  passwordResetUrl: string;
  randomToken: () => string;
  hashToken: (token: string) => string;
  requireActiveUser: (userId: string) => Promise<UserRecord>;
  domainError: (code: PasswordErrorCode, message: string) => Error;
}

export class AuthPasswordCoordinator {
  constructor(private readonly options: AuthPasswordCoordinatorOptions) {}

  async requestReset(emailInput: string): Promise<void> {
    const email = emailInput.trim().toLowerCase();
    const user = await this.options.repository.findUserByEmail(email);
    if (!user || user.status !== "active") return;

    const token = this.options.randomToken();
    const expiresAt = new Date(
      this.options.now().getTime() + 30 * 60_000,
    ).toISOString();
    const resetUrl = new URL(this.options.passwordResetUrl);
    resetUrl.searchParams.set("token", token);
    const message = {
      recipient: user.email,
      resetUrl: resetUrl.toString(),
      expiresAt,
    };
    const delivery = await this.options.repository.savePasswordReset(
      {
        tokenHash: this.options.hashToken(token),
        userId: user.id,
        expiresAt,
      },
      message,
    );
    if (delivery === "queued") return;
    try {
      await this.options.emailSender.sendPasswordReset(message);
    } catch {
      // Keep the response indistinguishable from an unknown address.
      // SMTP monitoring is responsible for surfacing delivery failures.
    }
  }

  async reset(input: {
    token: string;
    newPassword: string;
  }): Promise<void> {
    const reset = await this.options.repository.consumePasswordReset(
      this.options.hashToken(input.token),
      this.options.now().toISOString(),
    );
    if (!reset) {
      throw this.options.domainError(
        "PASSWORD_RESET_INVALID",
        "رابط إعادة التعيين منتهي أو مستخدم.",
      );
    }
    const updated = await this.options.repository.updateSecurity(
      reset.userId,
      { passwordHash: await hashPassword(input.newPassword) },
    );
    if (!updated) {
      throw this.options.domainError(
        "PASSWORD_RESET_INVALID",
        "رابط إعادة التعيين غير صالح.",
      );
    }
    await this.revokeCredentials(reset.userId);
  }

  async change(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await this.options.requireActiveUser(input.userId);
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw this.options.domainError(
        "CURRENT_PASSWORD_INVALID",
        "كلمة المرور الحالية غير صحيحة.",
      );
    }
    await this.options.repository.updateSecurity(user.id, {
      passwordHash: await hashPassword(input.newPassword),
    });
    await this.revokeCredentials(user.id);
  }

  private async revokeCredentials(userId: string): Promise<void> {
    await this.options.repository.deleteSessionsByUser(userId);
    await this.options.repository.deleteMfaChallengesByUser(userId);
    await this.options.repository.deletePasswordResetsByUser(userId);
  }
}
