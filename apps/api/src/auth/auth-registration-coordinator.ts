import { timingSafeEqual } from "node:crypto";
import type { LegalAcceptance, UserRole } from "@motionprep/contracts";
import type { AuthRepository, UserRecord } from "./auth-repository.js";
import type { EmailSender } from "./email-sender.js";
import { hashPassword } from "./password.js";

type RegistrationErrorCode =
  | "EMAIL_ALREADY_EXISTS"
  | "EMAIL_VERIFICATION_INVALID"
  | "ADMIN_BOOTSTRAP_DENIED";

interface RegistrationOptions {
  repository: AuthRepository;
  emailSender: EmailSender;
  now: () => Date;
  verificationRequired: boolean;
  verificationUrl: string;
  registrationRoleForEmail: (email: string) => UserRole;
  adminBootstrapEmail?: string;
  adminBootstrapTokenHash?: string;
  randomToken: () => string;
  hashToken: (token: string) => string;
  domainError: (code: RegistrationErrorCode, message: string) => Error;
}

export type RegistrationResult =
  | { kind: "active"; user: UserRecord }
  | { kind: "verification_required"; email: string; expiresAt: string };

export class AuthRegistrationCoordinator {
  constructor(private readonly options: RegistrationOptions) {}

  async register(input: {
    name: string;
    email: string;
    password: string;
    legal: LegalAcceptance;
  }): Promise<RegistrationResult> {
    const email = input.email.trim().toLowerCase();
    if (await this.options.repository.findUserByEmail(email)) {
      throw this.emailExists();
    }
    const timestamp = this.options.now().toISOString();
    const user = await this.createUser(input, email, timestamp, {
      role: this.options.registrationRoleForEmail(email),
      status: this.options.verificationRequired
        ? "pending_verification"
        : "active",
      lastLoginAt: this.options.verificationRequired ? null : timestamp,
    });
    if (!this.options.verificationRequired) {
      await this.options.repository.saveUser(user);
      return { kind: "active", user };
    }

    const { verification, message, expiresAt } = this.createVerification(user);
    const saved = await this.options.repository.savePendingRegistration(
      user,
      verification,
      message,
    );
    if (saved === "email_exists") throw this.emailExists();
    if (saved === "stored") {
      try {
        await this.options.emailSender.sendEmailVerification?.(message);
      } catch {
        // The account stays pending and a future resend can replace the token.
      }
    }
    return { kind: "verification_required", email, expiresAt };
  }

  async requestVerification(emailInput: string): Promise<void> {
    const user = await this.options.repository.findUserByEmail(
      emailInput.trim().toLowerCase(),
    );
    if (!user || user.status !== "pending_verification") return;
    const { verification, message } = this.createVerification(user);
    const saved = await this.options.repository.replaceEmailVerification(
      user.id,
      verification,
      message,
    );
    if (saved === "stored") {
      try {
        await this.options.emailSender.sendEmailVerification?.(message);
      } catch {
        // The public response stays non-enumerating; SMTP alerts expose failure.
      }
    }
  }

  async verifyEmail(token: string): Promise<UserRecord> {
    const user = await this.options.repository.consumeEmailVerification(
      this.options.hashToken(token),
      this.options.now().toISOString(),
    );
    if (!user) {
      throw this.options.domainError(
        "EMAIL_VERIFICATION_INVALID",
        "رابط التحقق من البريد منتهي أو مستخدم.",
      );
    }
    return user;
  }

  async bootstrapAdmin(input: {
    name: string;
    email: string;
    password: string;
    token: string;
    legal: LegalAcceptance;
  }): Promise<UserRecord> {
    const email = input.email.trim().toLowerCase();
    if (
      !this.options.adminBootstrapEmail ||
      !this.options.adminBootstrapTokenHash ||
      email !== this.options.adminBootstrapEmail ||
      !safeHashEqual(
        this.options.hashToken(input.token),
        this.options.adminBootstrapTokenHash,
      )
    ) {
      throw this.bootstrapDenied();
    }
    const timestamp = this.options.now().toISOString();
    const user = await this.createUser(input, email, timestamp, {
      role: "admin",
      status: "active",
      lastLoginAt: timestamp,
    });
    if (!(await this.options.repository.saveFirstAdmin(user))) {
      throw this.bootstrapDenied();
    }
    return user;
  }

  private async createUser(
    input: { name: string; password: string; legal: LegalAcceptance },
    email: string,
    timestamp: string,
    state: Pick<UserRecord, "role" | "status" | "lastLoginAt">,
  ): Promise<UserRecord> {
    return {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      email,
      ...state,
      passwordHash: await hashPassword(input.password),
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      recoveryCodeHashes: [],
      createdAt: timestamp,
      termsVersion: input.legal.termsVersion,
      privacyVersion: input.legal.privacyVersion,
      legalAcceptedAt: timestamp,
      deletionRequestedAt: null,
      deletedAt: null,
    };
  }

  private createVerification(user: UserRecord) {
    const token = this.options.randomToken();
    const expiresAt = new Date(
      this.options.now().getTime() + 24 * 60 * 60_000,
    ).toISOString();
    const verificationUrl = new URL(this.options.verificationUrl);
    verificationUrl.searchParams.set("verificationToken", token);
    return {
      expiresAt,
      verification: {
        tokenHash: this.options.hashToken(token),
        userId: user.id,
        expiresAt,
      },
      message: {
        recipient: user.email,
        verificationUrl: verificationUrl.toString(),
        expiresAt,
      },
    };
  }

  private emailExists(): Error {
    return this.options.domainError(
      "EMAIL_ALREADY_EXISTS",
      "البريد الإلكتروني مستخدم بالفعل.",
    );
  }

  private bootstrapDenied(): Error {
    return this.options.domainError(
      "ADMIN_BOOTSTRAP_DENIED",
      "تعذر تنفيذ تهيئة المسؤول.",
    );
  }
}

function safeHashEqual(actualHex: string, expectedHex: string): boolean {
  if (!/^[a-f0-9]{64}$/u.test(expectedHex)) return false;
  return timingSafeEqual(
    Buffer.from(actualHex, "hex"),
    Buffer.from(expectedHex, "hex"),
  );
}
