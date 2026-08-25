import { createHash, randomBytes } from "node:crypto";
import type {
  LegalAcceptance,
  SessionView,
  UserRole,
  UserStatus,
  UserSummary,
} from "@motionprep/contracts";
import {
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "./password.js";
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
import { AuthPasswordCoordinator } from "./auth-password-coordinator.js";
import { AuthUserAccessCoordinator } from "./auth-user-access-coordinator.js";
import { AuthMfaLoginCoordinator } from "./auth-mfa-login-coordinator.js";
import { AuthMfaSetupCoordinator } from "./auth-mfa-setup-coordinator.js";
import {
  AuthRegistrationCoordinator,
  type RegistrationResult,
} from "./auth-registration-coordinator.js";

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
  registrationRoleForEmail?: (email: string) => UserRole;
  emailVerificationRequired?: boolean;
  emailVerificationUrl?: string;
  adminBootstrapEmail?: string;
  adminBootstrapTokenHash?: string;
}

export class AuthDomainError extends Error {
  constructor(
    readonly code:
      | "EMAIL_ALREADY_EXISTS"
      | "INVALID_CREDENTIALS"
      | "ACCOUNT_LOCKED"
      | "ACCOUNT_SUSPENDED"
      | "SESSION_INVALID"
      | "AUTHORIZATION_DENIED"
      | "USER_NOT_FOUND"
      | "LAST_ADMIN_PROTECTED"
      | "MFA_REQUIRED"
      | "MFA_CODE_INVALID"
      | "MFA_CHALLENGE_INVALID"
      | "MFA_ALREADY_ENABLED"
      | "MFA_NOT_ENABLED"
      | "MFA_SETUP_INVALID"
      | "PASSWORD_RESET_INVALID"
      | "CURRENT_PASSWORD_INVALID"
      | "EMAIL_VERIFICATION_INVALID"
      | "ADMIN_BOOTSTRAP_DENIED",
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
  readonly #registrationRoleForEmail: (email: string) => UserRole;
  readonly #passwordCoordinator: AuthPasswordCoordinator;
  readonly #userAccessCoordinator: AuthUserAccessCoordinator;
  readonly #mfaLoginCoordinator: AuthMfaLoginCoordinator;
  readonly #mfaSetupCoordinator: AuthMfaSetupCoordinator;
  readonly #registrationCoordinator: AuthRegistrationCoordinator;

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
    this.#registrationRoleForEmail =
      security.registrationRoleForEmail ?? (() => "creator");
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
    this.#userAccessCoordinator = new AuthUserAccessCoordinator({
      repository: this.repository,
      now: this.now,
      publicUser: (user) => this.publicUser(user),
      domainError: (code, message) => new AuthDomainError(code, message),
    });
    this.#mfaLoginCoordinator = new AuthMfaLoginCoordinator({
      repository: this.repository,
      now: this.now,
      sessionTtlSeconds: this.sessionTtlSeconds,
      secretProtector: this.#secretProtector,
      randomToken: () => this.randomToken(),
      hashToken: (token) => this.hashToken(token),
      publicUser: (user) => this.publicUser(user),
      domainError: (code, message) => new AuthDomainError(code, message),
    });
    this.#mfaSetupCoordinator = new AuthMfaSetupCoordinator({
      repository: this.repository,
      now: this.now,
      secretProtector: this.#secretProtector,
      totpIssuer: this.#totpIssuer,
      randomToken: () => this.randomToken(),
      hashToken: (token) => this.hashToken(token),
      requireActiveUser: (userId) => this.requireActiveUser(userId),
      publicUser: (user) => this.publicUser(user),
      domainError: (code, message) => new AuthDomainError(code, message),
    });
    this.#registrationCoordinator = new AuthRegistrationCoordinator({
      repository: this.repository,
      emailSender: this.#emailSender,
      now: this.now,
      verificationRequired: security.emailVerificationRequired ?? false,
      verificationUrl:
        security.emailVerificationUrl ?? "http://localhost:5173/auth",
      registrationRoleForEmail: this.#registrationRoleForEmail,
      ...(security.adminBootstrapEmail
        ? { adminBootstrapEmail: security.adminBootstrapEmail }
        : {}),
      ...(security.adminBootstrapTokenHash
        ? { adminBootstrapTokenHash: security.adminBootstrapTokenHash }
        : {}),
      randomToken: () => this.randomToken(),
      hashToken: (token) => this.hashToken(token),
      domainError: (code, message) => new AuthDomainError(code, message),
    });
  }

  async register(input: {
    name: string;
    email: string;
    password: string;
    legal: LegalAcceptance;
  }): Promise<{ session: SessionView; token: string }> {
    const result = await this.registerWithPolicy(input);
    if (result.kind !== "session") {
      throw new Error("This registration path requires email verification.");
    }
    return { session: result.session, token: result.token };
  }

  async registerWithPolicy(input: {
    name: string;
    email: string;
    password: string;
    legal: LegalAcceptance;
  }): Promise<
    | { kind: "session"; session: SessionView; token: string }
    | Exclude<RegistrationResult, { kind: "active" }>
  > {
    const result = await this.#registrationCoordinator.register(input);
    return result.kind === "active"
      ? { kind: "session", ...(await this.createSession(result.user)) }
      : result;
  }

  async verifyEmail(token: string): Promise<{ session: SessionView; token: string }> {
    const user = await this.#registrationCoordinator.verifyEmail(token);
    return this.createSession(user);
  }

  requestEmailVerification(email: string): Promise<void> {
    return this.#registrationCoordinator.requestVerification(email);
  }

  async bootstrapAdmin(input: {
    name: string;
    email: string;
    password: string;
    token: string;
    legal: LegalAcceptance;
  }): Promise<{ session: SessionView; token: string }> {
    const user = await this.#registrationCoordinator.bootstrapAdmin(input);
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
    if (
      user.status !== "active" ||
      user.deletionRequestedAt ||
      user.deletedAt
    ) {
      throw new AuthDomainError(
        "ACCOUNT_SUSPENDED",
        "الحساب موقوف. تواصل مع الدعم.",
      );
    }

    if (passwordHashNeedsUpgrade(user.passwordHash)) {
      user.passwordHash = await hashPassword(input.password);
      await this.repository.updateSecurity(user.id, {
        passwordHash: user.passwordHash,
      });
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
    return this.#mfaLoginCoordinator.complete(input);
  }

  beginMfaSetup(userId: string): Promise<{
    setupToken: string;
    secret: string;
    otpAuthUri: string;
    expiresAt: string;
  }> {
    return this.#mfaSetupCoordinator.begin(userId);
  }

  confirmMfaSetup(input: {
    userId: string;
    setupToken: string;
    code: string;
  }): Promise<{ user: UserSummary; recoveryCodes: string[] }> {
    return this.#mfaSetupCoordinator.confirm(input);
  }

  disableMfa(input: {
    userId: string;
    password: string;
    code: string;
  }): Promise<void> {
    return this.#mfaSetupCoordinator.disable(input);
  }

  async requestPasswordReset(emailInput: string): Promise<void> {
    return this.#passwordCoordinator.requestReset(emailInput);
  }

  async resetPassword(input: {
    token: string;
    newPassword: string;
  }): Promise<string> {
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
    if (
      !user ||
      user.status !== "active" ||
      user.deletionRequestedAt ||
      user.deletedAt
    ) {
      throw new AuthDomainError("SESSION_INVALID", "الجلسة غير صالحة.");
    }
    return { user: this.publicUser(user), expiresAt: record.expiresAt };
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) await this.repository.deleteSession(this.hashToken(token));
  }

  async verifyCurrentPassword(userId: string, password: string): Promise<void> {
    const user = await this.requireActiveUser(userId);
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw new AuthDomainError(
        "CURRENT_PASSWORD_INVALID",
        "كلمة المرور الحالية غير صحيحة.",
      );
    }
  }

  async listUsers(): Promise<UserSummary[]> {
    return this.#userAccessCoordinator.listUsers();
  }

  async updateUserAccess(
    actor: UserSummary,
    userId: string,
    changes: { role?: UserRole; status?: UserStatus },
  ): Promise<UserSummary> {
    return this.#userAccessCoordinator.updateUserAccess(actor, userId, changes);
  }

  async seedUser(input: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
  }): Promise<UserSummary> {
    return this.#userAccessCoordinator.seedUser(input);
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
      termsVersion: _termsVersion,
      privacyVersion: _privacyVersion,
      legalAcceptedAt: _legalAcceptedAt,
      deletionRequestedAt: _deletionRequestedAt,
      deletedAt: _deletedAt,
      ...summary
    } = user;
    return summary;
  }

  private async requireActiveUser(userId: string): Promise<UserRecord> {
    const user = await this.repository.findUserById(userId);
    if (
      !user ||
      user.status !== "active" ||
      user.deletionRequestedAt ||
      user.deletedAt
    ) {
      throw new AuthDomainError("USER_NOT_FOUND", "المستخدم غير موجود.");
    }
    return user;
  }

  private randomToken(): string {
    return randomBytes(32).toString("base64url");
  }

}
