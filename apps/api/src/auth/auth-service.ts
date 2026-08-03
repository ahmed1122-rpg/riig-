import { createHash, randomBytes } from "node:crypto";
import type {
  SessionView,
  UserRole,
  UserStatus,
  UserSummary,
} from "@motionprep/contracts";
import { hashPassword, verifyPassword } from "./password.js";
import type {
  AuthRepository,
  SessionRecord,
  UserRecord,
} from "./auth-repository.js";
import {
  InMemoryLoginAttemptStore,
  type LoginAttemptStore,
} from "./login-attempt-store.js";
import {
  InMemoryEmailSender,
  type EmailSender,
} from "./email-sender.js";
import {
  createEphemeralSecretProtector,
  type SecretProtector,
} from "./secret-protector.js";
import {
  createOtpAuthUri, formatRecoveryCode,
  generateTotpSecret,
  verifyTotpCode,
} from "./totp.js";
import { AuthPasswordCoordinator } from "./auth-password-coordinator.js";

export const SESSION_COOKIE_NAME = "motionprep_session";

export type LoginResult =
  | {
      kind: "session";
      session: SessionView;
      token: string;
    }
  | {
      kind: "mfa_required";
      challengeToken: string;
      expiresAt: string;
    };

export interface AuthSecurityOptions {
  secretProtector?: SecretProtector;
  emailSender?: EmailSender;
  passwordResetUrl?: string;
  totpIssuer?: string;
}

export class AuthDomainError extends Error {
  constructor(
    readonly code:
      | "EMAIL_ALREADY_EXISTS"
      | "INVALID_CREDENTIALS"
      | "ACCOUNT_LOCKED"
      | "ACCOUNT_SUSPENDED"
      | "SESSION_INVALID"
      | "USER_NOT_FOUND"
      | "LAST_ADMIN_PROTECTED"
      | "MFA_REQUIRED"
      | "MFA_CODE_INVALID"
      | "MFA_CHALLENGE_INVALID"
      | "MFA_ALREADY_ENABLED"
      | "MFA_NOT_ENABLED"
      | "MFA_SETUP_INVALID"
      | "PASSWORD_RESET_INVALID"
      | "CURRENT_PASSWORD_INVALID",
    message: string,
  ) {
    super(message);
  }
}

export class AuthService {
  readonly #secretProtector: SecretProtector;
  readonly #emailSender: EmailSender;
  readonly #passwordResetUrl: string;
  readonly #totpIssuer: string;
  readonly #passwordCoordinator: AuthPasswordCoordinator;

  constructor(
    readonly repository: AuthRepository,
    private readonly now: () => Date = () => new Date(),
    private readonly sessionTtlSeconds = 8 * 60 * 60,
    private readonly loginAttempts: LoginAttemptStore =
      new InMemoryLoginAttemptStore(now),
    security: AuthSecurityOptions = {},
  ) {
    this.#secretProtector =
      security.secretProtector ?? createEphemeralSecretProtector();
    this.#emailSender = security.emailSender ?? new InMemoryEmailSender();
    this.#passwordResetUrl =
      security.passwordResetUrl ?? "http://localhost:5173/auth/reset";
    this.#totpIssuer = security.totpIssuer ?? "MotionPrep";
    this.#passwordCoordinator = new AuthPasswordCoordinator({
      repository: this.repository,
      now: this.now,
      emailSender: this.#emailSender,
      passwordResetUrl: this.#passwordResetUrl,
      randomToken: () => this.randomToken(),
      hashToken: (token) => this.hashToken(token),
      requireActiveUser: (userId) => this.requireActiveUser(userId),
      domainError: (code, message) => new AuthDomainError(code, message),
    });
  }

  async register(input: {
    name: string;
    email: string;
    password: string;
  }): Promise<{ session: SessionView; token: string }> {
    const email = input.email.trim().toLowerCase();
    if (await this.repository.findUserByEmail(email)) {
      throw new AuthDomainError(
        "EMAIL_ALREADY_EXISTS",
        "البريد الإلكتروني مستخدم بالفعل.",
      );
    }

    const timestamp = this.now().toISOString();
    const user: UserRecord = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      email,
      role: "creator",
      status: "active",
      passwordHash: await hashPassword(input.password),
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      recoveryCodeHashes: [],
      createdAt: timestamp,
      lastLoginAt: timestamp,
    };
    await this.repository.saveUser(user);
    return this.createSession(user);
  }

  async login(input: {
    email: string;
    password: string;
    attemptKey: string;
  }): Promise<LoginResult> {
    const email = input.email.trim().toLowerCase();
    if (await this.loginAttempts.isLocked(input.attemptKey)) {
      throw new AuthDomainError(
        "ACCOUNT_LOCKED",
        "محاولات كثيرة. حاول مرة أخرى لاحقًا.",
      );
    }

    const user = await this.repository.findUserByEmail(email);
    const valid = user
      ? await verifyPassword(input.password, user.passwordHash)
      : false;
    if (!user || !valid) {
      await this.loginAttempts.recordFailure(input.attemptKey);
      throw new AuthDomainError(
        "INVALID_CREDENTIALS",
        "بيانات الدخول غير صحيحة.",
      );
    }
    if (user.status === "suspended") {
      throw new AuthDomainError(
        "ACCOUNT_SUSPENDED",
        "الحساب موقوف. تواصل مع الدعم.",
      );
    }

    await this.loginAttempts.clear(input.attemptKey);
    if (user.mfaEnabled) {
      const challengeToken = this.randomToken();
      const expiresAt = new Date(
        this.now().getTime() + 5 * 60_000,
      ).toISOString();
      await this.repository.saveMfaChallenge({
        tokenHash: this.hashToken(challengeToken),
        userId: user.id,
        expiresAt,
      });
      return {
        kind: "mfa_required",
        challengeToken,
        expiresAt,
      };
    }

    return this.finishLogin(user);
  }

  async completeMfaLogin(input: {
    challengeToken: string;
    code: string;
  }): Promise<Extract<LoginResult, { kind: "session" }>> {
    const tokenHash = this.hashToken(input.challengeToken);
    const challenge = await this.repository.findMfaChallenge(
      tokenHash,
      this.now().toISOString(),
    );
    if (!challenge) {
      throw new AuthDomainError(
        "MFA_CHALLENGE_INVALID",
        "انتهى تحدي التحقق أو لم يعد صالحًا.",
      );
    }
    const user = await this.repository.findUserById(challenge.userId);
    if (!user || !user.mfaEnabled || user.status !== "active") {
      throw new AuthDomainError(
        "MFA_CHALLENGE_INVALID",
        "تحدي التحقق غير صالح.",
      );
    }
    if (!(await this.verifySecondFactor(user, input.code))) {
      throw new AuthDomainError(
        "MFA_CODE_INVALID",
        "رمز التحقق غير صحيح.",
      );
    }
    await this.repository.deleteMfaChallengesByUser(user.id);
    return this.finishLogin(user);
  }

  async beginMfaSetup(userId: string): Promise<{
    setupToken: string;
    secret: string;
    otpAuthUri: string;
    expiresAt: string;
  }> {
    const user = await this.requireActiveUser(userId);
    if (user.mfaEnabled) {
      throw new AuthDomainError(
        "MFA_ALREADY_ENABLED",
        "المصادقة الثنائية مفعلة بالفعل.",
      );
    }
    const secret = generateTotpSecret(randomBytes(20));
    const setupToken = this.randomToken();
    const expiresAt = new Date(
      this.now().getTime() + 10 * 60_000,
    ).toISOString();
    await this.repository.saveMfaEnrollment({
      tokenHash: this.hashToken(setupToken),
      userId,
      secretCiphertext: this.#secretProtector.protect(secret),
      expiresAt,
    });
    return {
      setupToken,
      secret,
      otpAuthUri: createOtpAuthUri({
        issuer: this.#totpIssuer,
        account: user.email,
        secret,
      }),
      expiresAt,
    };
  }

  async confirmMfaSetup(input: {
    userId: string;
    setupToken: string;
    code: string;
  }): Promise<{ user: UserSummary; recoveryCodes: string[] }> {
    const tokenHash = this.hashToken(input.setupToken);
    const enrollment = await this.repository.consumeMfaEnrollment(
      tokenHash,
      input.userId,
      this.now().toISOString(),
    );
    if (!enrollment) {
      throw new AuthDomainError(
        "MFA_SETUP_INVALID",
        "انتهت جلسة إعداد المصادقة الثنائية.",
      );
    }
    const secret = this.#secretProtector.unprotect(
      enrollment.secretCiphertext,
    );
    if (!verifyTotpCode(secret, input.code, this.now().getTime())) {
      await this.repository.saveMfaEnrollment(enrollment);
      throw new AuthDomainError(
        "MFA_CODE_INVALID",
        "رمز تطبيق المصادقة غير صحيح.",
      );
    }

    const recoveryCodes = Array.from({ length: 10 }, () =>
      formatRecoveryCode(randomBytes(5).toString("hex")),
    );
    const updated = await this.repository.updateSecurity(input.userId, {
      mfaEnabled: true,
      mfaSecretCiphertext: enrollment.secretCiphertext,
      recoveryCodeHashes: recoveryCodes.map((code) =>
        this.#secretProtector.hashRecoveryCode(code),
      ),
    });
    if (!updated) {
      throw new AuthDomainError("USER_NOT_FOUND", "المستخدم غير موجود.");
    }
    await this.repository.deleteSessionsByUser(input.userId);
    return { user: this.publicUser(updated), recoveryCodes };
  }

  async disableMfa(input: {
    userId: string;
    password: string;
    code: string;
  }): Promise<void> {
    const user = await this.requireActiveUser(input.userId);
    if (!user.mfaEnabled) {
      throw new AuthDomainError(
        "MFA_NOT_ENABLED",
        "المصادقة الثنائية غير مفعلة.",
      );
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw new AuthDomainError(
        "CURRENT_PASSWORD_INVALID",
        "كلمة المرور الحالية غير صحيحة.",
      );
    }
    if (!(await this.verifySecondFactor(user, input.code))) {
      throw new AuthDomainError(
        "MFA_CODE_INVALID",
        "رمز التحقق غير صحيح.",
      );
    }
    await this.repository.updateSecurity(user.id, {
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      recoveryCodeHashes: [],
    });
    await this.repository.deleteSessionsByUser(user.id);
    await this.repository.deleteMfaChallengesByUser(user.id);
  }

  async requestPasswordReset(emailInput: string): Promise<void> {
    return this.#passwordCoordinator.requestReset(emailInput);
  }

  async resetPassword(input: {
    token: string;
    newPassword: string;
  }): Promise<void> {
    return this.#passwordCoordinator.reset(input);
  }

  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    return this.#passwordCoordinator.change(input);
  }

  private async finishLogin(
    user: UserRecord,
  ): Promise<Extract<LoginResult, { kind: "session" }>> {
    const lastLoginAt = this.now().toISOString();
    const updated =
      (await this.repository.updateUser(user.id, { lastLoginAt })) ?? user;
    const result = await this.createSession(updated);
    return { kind: "session", ...result };
  }

  async session(token: string | undefined): Promise<SessionView> {
    if (!token) {
      throw new AuthDomainError("SESSION_INVALID", "الجلسة غير صالحة.");
    }
    const tokenHash = this.hashToken(token);
    const record = await this.repository.findSession(tokenHash);
    if (!record || new Date(record.expiresAt).getTime() <= this.now().getTime()) {
      if (record) await this.repository.deleteSession(tokenHash);
      throw new AuthDomainError("SESSION_INVALID", "انتهت الجلسة.");
    }
    const user = await this.repository.findUserById(record.userId);
    if (!user || user.status !== "active") {
      throw new AuthDomainError("SESSION_INVALID", "الجلسة غير صالحة.");
    }
    return { user: this.publicUser(user), expiresAt: record.expiresAt };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.repository.deleteSession(this.hashToken(token));
  }

  async listUsers(): Promise<UserSummary[]> {
    return (await this.repository.listUsers()).map((user) =>
      this.publicUser(user),
    );
  }

  async updateUserAccess(
    actor: UserSummary,
    userId: string,
    changes: { role?: UserRole; status?: UserStatus },
  ): Promise<UserSummary> {
    if (actor.role !== "admin") {
      throw new AuthDomainError("SESSION_INVALID", "ليس لديك صلاحية كافية.");
    }
    const target = await this.repository.findUserById(userId);
    if (!target) {
      throw new AuthDomainError("USER_NOT_FOUND", "المستخدم غير موجود.");
    }
    const removesAdminAccess =
      target.role === "admin" &&
      ((changes.role !== undefined && changes.role !== "admin") ||
        changes.status === "suspended");
    if (removesAdminAccess) {
      const activeAdmins = (await this.repository.listUsers()).filter(
        (user) => user.role === "admin" && user.status === "active",
      );
      if (activeAdmins.length <= 1) {
        throw new AuthDomainError(
          "LAST_ADMIN_PROTECTED",
          "لا يمكن إزالة صلاحية آخر مسؤول نشط.",
        );
      }
    }
    if (actor.id === userId && changes.status === "suspended") {
      throw new AuthDomainError(
        "LAST_ADMIN_PROTECTED",
        "لا يمكن للمسؤول إيقاف حسابه الحالي.",
      );
    }
    const updated = await this.repository.updateUser(userId, changes);
    if (!updated) {
      throw new AuthDomainError("USER_NOT_FOUND", "المستخدم غير موجود.");
    }
    if (changes.role !== undefined || changes.status === "suspended") {
      await this.repository.deleteSessionsByUser(userId);
    }
    return this.publicUser(updated);
  }

  async seedUser(input: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
  }): Promise<UserSummary> {
    const existing = await this.repository.findUserByEmail(input.email);
    if (existing) return this.publicUser(existing);
    const timestamp = this.now().toISOString();
    const user: UserRecord = {
      id: crypto.randomUUID(),
      name: input.name,
      email: input.email.trim().toLowerCase(),
      passwordHash: await hashPassword(input.password),
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      recoveryCodeHashes: [],
      role: input.role,
      status: "active",
      createdAt: timestamp,
      lastLoginAt: null,
    };
    await this.repository.saveUser(user);
    return this.publicUser(user);
  }

  private async createSession(
    user: UserRecord,
  ): Promise<{ session: SessionView; token: string }> {
    const token = randomBytes(32).toString("base64url");
    const now = this.now();
    const expiresAt = new Date(
      now.getTime() + this.sessionTtlSeconds * 1000,
    ).toISOString();
    const record: SessionRecord = {
      tokenHash: this.hashToken(token),
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt,
    };
    await this.repository.saveSession(record);
    return {
      token,
      session: { user: this.publicUser(user), expiresAt },
    };
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private publicUser(user: UserRecord): UserSummary {
    const {
      passwordHash: _passwordHash,
      mfaSecretCiphertext: _mfaSecretCiphertext,
      recoveryCodeHashes: _recoveryCodeHashes,
      ...summary
    } = user;
    return summary;
  }

  private async requireActiveUser(userId: string): Promise<UserRecord> {
    const user = await this.repository.findUserById(userId);
    if (!user || user.status !== "active") {
      throw new AuthDomainError("USER_NOT_FOUND", "المستخدم غير موجود.");
    }
    return user;
  }

  private async verifySecondFactor(
    user: UserRecord,
    code: string,
  ): Promise<boolean> {
    if (!user.mfaSecretCiphertext) return false;
    const secret = this.#secretProtector.unprotect(
      user.mfaSecretCiphertext,
    );
    if (verifyTotpCode(secret, code, this.now().getTime())) return true;

    const recoveryIndex = user.recoveryCodeHashes.findIndex((hash) =>
      this.#secretProtector.verifyRecoveryCode(code, hash),
    );
    if (recoveryIndex < 0) return false;
    await this.repository.updateSecurity(user.id, {
      recoveryCodeHashes: user.recoveryCodeHashes.filter(
        (_hash, index) => index !== recoveryIndex,
      ),
    });
    return true;
  }

  private randomToken(): string {
    return randomBytes(32).toString("base64url");
  }

}
