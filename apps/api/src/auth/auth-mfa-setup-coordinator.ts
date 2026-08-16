import { randomBytes } from "node:crypto";
import type { UserSummary } from "@motionprep/contracts";
import type { AuthRepository, UserRecord } from "./auth-repository.js";
import { matchSecondFactor } from "./auth-mfa-login-coordinator.js";
import { verifyPassword } from "./password.js";
import type { SecretProtector } from "./secret-protector.js";
import {
  createOtpAuthUri,
  formatRecoveryCode,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp.js";

type MfaSetupErrorCode =
  | "CURRENT_PASSWORD_INVALID"
  | "MFA_ALREADY_ENABLED"
  | "MFA_CODE_INVALID"
  | "MFA_NOT_ENABLED"
  | "MFA_SETUP_INVALID"
  | "USER_NOT_FOUND";

interface AuthMfaSetupCoordinatorOptions {
  repository: AuthRepository;
  now: () => Date;
  secretProtector: SecretProtector;
  totpIssuer: string;
  randomToken: () => string;
  hashToken: (token: string) => string;
  requireActiveUser: (userId: string) => Promise<UserRecord>;
  publicUser: (user: UserRecord) => UserSummary;
  domainError: (code: MfaSetupErrorCode, message: string) => Error;
}

export class AuthMfaSetupCoordinator {
  constructor(private readonly options: AuthMfaSetupCoordinatorOptions) {}

  async begin(userId: string): Promise<{
    setupToken: string;
    secret: string;
    otpAuthUri: string;
    expiresAt: string;
  }> {
    const user = await this.options.requireActiveUser(userId);
    if (user.mfaEnabled) {
      throw this.options.domainError(
        "MFA_ALREADY_ENABLED",
        "المصادقة الثنائية مفعلة بالفعل.",
      );
    }
    const secret = generateTotpSecret(randomBytes(20));
    const setupToken = this.options.randomToken();
    const expiresAt = new Date(
      this.options.now().getTime() + 10 * 60_000,
    ).toISOString();
    await this.options.repository.saveMfaEnrollment({
      tokenHash: this.options.hashToken(setupToken),
      userId,
      secretCiphertext: this.options.secretProtector.protect(secret),
      expiresAt,
    });
    return {
      setupToken,
      secret,
      otpAuthUri: createOtpAuthUri({
        issuer: this.options.totpIssuer,
        account: user.email,
        secret,
      }),
      expiresAt,
    };
  }

  async confirm(input: {
    userId: string;
    setupToken: string;
    code: string;
  }): Promise<{ user: UserSummary; recoveryCodes: string[] }> {
    const enrollment = await this.options.repository.consumeMfaEnrollment(
      this.options.hashToken(input.setupToken),
      input.userId,
      this.options.now().toISOString(),
    );
    if (!enrollment) {
      throw this.options.domainError(
        "MFA_SETUP_INVALID",
        "انتهت جلسة إعداد المصادقة الثنائية.",
      );
    }
    const secret = this.options.secretProtector.unprotect(
      enrollment.secretCiphertext,
    );
    if (!verifyTotpCode(secret, input.code, this.options.now().getTime())) {
      await this.options.repository.saveMfaEnrollment(enrollment);
      throw this.options.domainError(
        "MFA_CODE_INVALID",
        "رمز تطبيق المصادقة غير صحيح.",
      );
    }
    const recoveryCodes = Array.from({ length: 10 }, () =>
      formatRecoveryCode(randomBytes(5).toString("hex")),
    );
    const updated = await this.options.repository.updateSecurity(input.userId, {
      mfaEnabled: true,
      mfaSecretCiphertext: enrollment.secretCiphertext,
      recoveryCodeHashes: recoveryCodes.map((code) =>
        this.options.secretProtector.hashRecoveryCode(code),
      ),
    });
    if (!updated) {
      throw this.options.domainError("USER_NOT_FOUND", "المستخدم غير موجود.");
    }
    await this.options.repository.deleteSessionsByUser(input.userId);
    return { user: this.options.publicUser(updated), recoveryCodes };
  }

  async disable(input: {
    userId: string;
    password: string;
    code: string;
  }): Promise<void> {
    const user = await this.options.requireActiveUser(input.userId);
    if (!user.mfaEnabled) {
      throw this.options.domainError(
        "MFA_NOT_ENABLED",
        "المصادقة الثنائية غير مفعلة.",
      );
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw this.options.domainError(
        "CURRENT_PASSWORD_INVALID",
        "كلمة المرور الحالية غير صحيحة.",
      );
    }
    const factor = matchSecondFactor(
      user,
      input.code,
      this.options.secretProtector,
      this.options.now().getTime(),
    );
    if (!factor) {
      throw this.options.domainError("MFA_CODE_INVALID", "رمز التحقق غير صحيح.");
    }
    if (
      factor.kind === "recovery" &&
      !(await this.options.repository.consumeRecoveryCode(user.id, factor.codeHash))
    ) {
      throw this.options.domainError(
        "MFA_CODE_INVALID",
        "رمز الاسترداد غير صالح أو استُخدم سابقًا.",
      );
    }
    await this.options.repository.updateSecurity(user.id, {
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      recoveryCodeHashes: [],
    });
    await this.options.repository.deleteSessionsByUser(user.id);
    await this.options.repository.deleteMfaChallengesByUser(user.id);
  }
}
