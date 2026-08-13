import type { UserRole, UserStatus, UserSummary } from "@motionprep/contracts";
import type {
  EmailVerificationMessage,
  PasswordResetMessage,
} from "./email-sender.js";

export interface UserRecord extends UserSummary {
  passwordHash: string;
  mfaSecretCiphertext: string | null;
  recoveryCodeHashes: string[];
  termsVersion?: string | null;
  privacyVersion?: string | null;
  legalAcceptedAt?: string | null;
  deletionRequestedAt?: string | null;
  deletedAt?: string | null;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

export interface MfaEnrollmentRecord {
  tokenHash: string;
  userId: string;
  secretCiphertext: string;
  expiresAt: string;
}

export interface MfaChallengeRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

export interface MfaLoginCommit {
  tokenHash: string;
  userId: string;
  now: string;
  lastLoginAt: string;
  session: SessionRecord;
  recoveryCodeHash?: string;
}

export type MfaLoginCommitResult =
  | "committed"
  | "challenge_invalid"
  | "user_invalid"
  | "recovery_invalid";

export interface PasswordResetRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

export interface EmailVerificationRecord {
  tokenHash: string;
  userId: string;
  expiresAt: string;
}

export interface UserSecurityChanges {
  passwordHash?: string;
  mfaEnabled?: boolean;
  mfaSecretCiphertext?: string | null;
  recoveryCodeHashes?: string[];
}

export interface AuthRepository {
  findUserById(id: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  listUsers(): Promise<UserRecord[]>;
  saveUser(user: UserRecord): Promise<void>;
  savePendingRegistration(
    user: UserRecord,
    verification: EmailVerificationRecord,
    delivery?: EmailVerificationMessage,
  ): Promise<"queued" | "stored" | "email_exists">;
  consumeEmailVerification(
    tokenHash: string,
    now: string,
  ): Promise<UserRecord | null>;
  replaceEmailVerification(
    userId: string,
    verification: EmailVerificationRecord,
    delivery?: EmailVerificationMessage,
  ): Promise<"queued" | "stored" | "not_pending">;
  deleteEmailVerificationsByUser(userId: string): Promise<void>;
  saveFirstAdmin(user: UserRecord): Promise<boolean>;
  updateUser(
    id: string,
    changes: Partial<Pick<UserRecord, "role" | "status" | "lastLoginAt">>,
  ): Promise<UserRecord | null>;
  updateSecurity(
    id: string,
    changes: UserSecurityChanges,
  ): Promise<UserRecord | null>;
  findSession(tokenHash: string): Promise<SessionRecord | null>;
  saveSession(session: SessionRecord): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteSessionsByUser(userId: string): Promise<void>;
  saveMfaEnrollment(record: MfaEnrollmentRecord): Promise<void>;
  consumeMfaEnrollment(
    tokenHash: string,
    userId: string,
    now: string,
  ): Promise<MfaEnrollmentRecord | null>;
  saveMfaChallenge(record: MfaChallengeRecord): Promise<void>;
  findMfaChallenge(
    tokenHash: string,
    now: string,
  ): Promise<MfaChallengeRecord | null>;
  commitMfaLogin(input: MfaLoginCommit): Promise<MfaLoginCommitResult>;
  consumeRecoveryCode(userId: string, codeHash: string): Promise<boolean>;
  deleteMfaChallenge(tokenHash: string): Promise<void>;
  deleteMfaChallengesByUser(userId: string): Promise<void>;
  savePasswordReset(
    record: PasswordResetRecord,
    delivery?: PasswordResetMessage,
  ): Promise<"queued" | "stored">;
  consumePasswordReset(
    tokenHash: string,
    now: string,
  ): Promise<PasswordResetRecord | null>;
  deletePasswordResetsByUser(userId: string): Promise<void>;
}

export class InMemoryAuthRepository implements AuthRepository {
  readonly #users = new Map<string, UserRecord>();
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #mfaEnrollments = new Map<string, MfaEnrollmentRecord>();
  readonly #mfaChallenges = new Map<string, MfaChallengeRecord>();
  readonly #passwordResets = new Map<string, PasswordResetRecord>();
  readonly #emailVerifications = new Map<string, EmailVerificationRecord>();
  #securityCommandTail: Promise<void> = Promise.resolve();

  async findUserById(id: string): Promise<UserRecord | null> {
    return this.#users.get(id) ?? null;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    const normalized = email.trim().toLowerCase();
    return (
      [...this.#users.values()].find((user) => user.email === normalized) ??
      null
    );
  }

  async listUsers(): Promise<UserRecord[]> {
    return [...this.#users.values()].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  async saveUser(user: UserRecord): Promise<void> {
    this.#users.set(user.id, user);
  }

  async savePendingRegistration(
    user: UserRecord,
    verification: EmailVerificationRecord,
    _delivery?: EmailVerificationMessage,
  ): Promise<"stored" | "email_exists"> {
    return this.#runSecurityCommand(() => {
      if ([...this.#users.values()].some((stored) => stored.email === user.email)) {
        return "email_exists";
      }
      this.#users.set(user.id, user);
      this.#emailVerifications.set(verification.tokenHash, verification);
      return "stored";
    });
  }

  async consumeEmailVerification(
    tokenHash: string,
    now: string,
  ): Promise<UserRecord | null> {
    return this.#runSecurityCommand(() => {
      const verification = this.#emailVerifications.get(tokenHash);
      if (!verification || verification.expiresAt <= now) {
        if (verification) this.#emailVerifications.delete(tokenHash);
        return null;
      }
      const user = this.#users.get(verification.userId);
      if (!user || user.status !== "pending_verification") return null;
      const updated = { ...user, status: "active" as const, lastLoginAt: now };
      this.#users.set(user.id, updated);
      this.#emailVerifications.delete(tokenHash);
      return updated;
    });
  }

  async replaceEmailVerification(
    userId: string,
    verification: EmailVerificationRecord,
    _delivery?: EmailVerificationMessage,
  ): Promise<"stored" | "not_pending"> {
    return this.#runSecurityCommand(() => {
      const user = this.#users.get(userId);
      if (
        !user ||
        user.status !== "pending_verification" ||
        user.deletionRequestedAt ||
        user.deletedAt
      ) {
        return "not_pending";
      }
      for (const [tokenHash, stored] of this.#emailVerifications) {
        if (stored.userId === userId) this.#emailVerifications.delete(tokenHash);
      }
      this.#emailVerifications.set(verification.tokenHash, verification);
      return "stored";
    });
  }

  async deleteEmailVerificationsByUser(userId: string): Promise<void> {
    for (const [tokenHash, verification] of this.#emailVerifications) {
      if (verification.userId === userId) this.#emailVerifications.delete(tokenHash);
    }
  }

  async saveFirstAdmin(user: UserRecord): Promise<boolean> {
    return this.#runSecurityCommand(() => {
      if (
        [...this.#users.values()].some((stored) => stored.role === "admin") ||
        [...this.#users.values()].some((stored) => stored.email === user.email)
      ) {
        return false;
      }
      this.#users.set(user.id, user);
      return true;
    });
  }

  async updateUser(
    id: string,
    changes: Partial<{
      role: UserRole;
      status: UserStatus;
      lastLoginAt: string | null;
    }>,
  ): Promise<UserRecord | null> {
    return this.#updateStoredUser(id, changes);
  }

  async updateSecurity(
    id: string,
    changes: UserSecurityChanges,
  ): Promise<UserRecord | null> {
    return this.#updateStoredUser(id, changes);
  }

  #updateStoredUser(
    id: string,
    changes: Partial<UserRecord>,
  ): UserRecord | null {
    const user = this.#users.get(id);
    if (!user) return null;
    const updated = { ...user, ...changes };
    this.#users.set(id, updated);
    return updated;
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    return this.#sessions.get(tokenHash) ?? null;
  }

  async saveSession(session: SessionRecord): Promise<void> {
    this.#sessions.set(session.tokenHash, session);
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.#sessions.delete(tokenHash);
  }

  async deleteSessionsByUser(userId: string): Promise<void> {
    for (const [tokenHash, session] of this.#sessions) {
      if (session.userId === userId) this.#sessions.delete(tokenHash);
    }
  }

  async saveMfaEnrollment(record: MfaEnrollmentRecord): Promise<void> {
    this.#mfaEnrollments.set(record.tokenHash, record);
  }

  async consumeMfaEnrollment(
    tokenHash: string,
    userId: string,
    now: string,
  ): Promise<MfaEnrollmentRecord | null> {
    const record = this.#mfaEnrollments.get(tokenHash);
    if (!record || record.userId !== userId || record.expiresAt <= now) {
      if (record?.expiresAt && record.expiresAt <= now) {
        this.#mfaEnrollments.delete(tokenHash);
      }
      return null;
    }
    this.#mfaEnrollments.delete(tokenHash);
    return record;
  }

  async saveMfaChallenge(record: MfaChallengeRecord): Promise<void> {
    this.#mfaChallenges.set(record.tokenHash, record);
  }

  async findMfaChallenge(
    tokenHash: string,
    now: string,
  ): Promise<MfaChallengeRecord | null> {
    const record = this.#mfaChallenges.get(tokenHash);
    if (!record || record.expiresAt <= now) {
      if (record) this.#mfaChallenges.delete(tokenHash);
      return null;
    }
    return record;
  }

  async commitMfaLogin(
    input: MfaLoginCommit,
  ): Promise<MfaLoginCommitResult> {
    return this.#runSecurityCommand(() => {
      const user = this.#users.get(input.userId);
      if (
        !user ||
        !user.mfaEnabled ||
        user.status !== "active" ||
        user.deletionRequestedAt ||
        user.deletedAt
      ) {
        return "user_invalid";
      }
      const challenge = this.#mfaChallenges.get(input.tokenHash);
      if (
        !challenge ||
        challenge.userId !== input.userId ||
        challenge.expiresAt <= input.now
      ) {
        if (challenge?.expiresAt && challenge.expiresAt <= input.now) {
          this.#mfaChallenges.delete(input.tokenHash);
        }
        return "challenge_invalid";
      }
      if (
        input.recoveryCodeHash &&
        !user.recoveryCodeHashes.includes(input.recoveryCodeHash)
      ) {
        return "recovery_invalid";
      }
      if (input.session.userId !== input.userId) {
        throw new Error("MFA session owner must match the challenge owner.");
      }

      this.#users.set(user.id, {
        ...user,
        lastLoginAt: input.lastLoginAt,
        recoveryCodeHashes: input.recoveryCodeHash
          ? user.recoveryCodeHashes.filter(
              (hash) => hash !== input.recoveryCodeHash,
            )
          : user.recoveryCodeHashes,
      });
      this.#sessions.set(input.session.tokenHash, input.session);
      for (const [tokenHash, stored] of this.#mfaChallenges) {
        if (stored.userId === input.userId) {
          this.#mfaChallenges.delete(tokenHash);
        }
      }
      return "committed";
    });
  }

  async consumeRecoveryCode(
    userId: string,
    codeHash: string,
  ): Promise<boolean> {
    return this.#runSecurityCommand(() => {
      const user = this.#users.get(userId);
      if (
        !user ||
        !user.mfaEnabled ||
        user.status !== "active" ||
        user.deletionRequestedAt ||
        user.deletedAt ||
        !user.recoveryCodeHashes.includes(codeHash)
      ) {
        return false;
      }
      this.#users.set(userId, {
        ...user,
        recoveryCodeHashes: user.recoveryCodeHashes.filter(
          (storedHash) => storedHash !== codeHash,
        ),
      });
      return true;
    });
  }

  async #runSecurityCommand<Result>(command: () => Result): Promise<Result> {
    const previous = this.#securityCommandTail;
    let release!: () => void;
    this.#securityCommandTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return command();
    } finally {
      release();
    }
  }

  async deleteMfaChallenge(tokenHash: string): Promise<void> {
    this.#mfaChallenges.delete(tokenHash);
  }

  async deleteMfaChallengesByUser(userId: string): Promise<void> {
    for (const [tokenHash, challenge] of this.#mfaChallenges) {
      if (challenge.userId === userId) this.#mfaChallenges.delete(tokenHash);
    }
  }

  async savePasswordReset(
    record: PasswordResetRecord,
    _delivery?: PasswordResetMessage,
  ): Promise<"stored"> {
    this.#passwordResets.set(record.tokenHash, record);
    return "stored";
  }

  async consumePasswordReset(
    tokenHash: string,
    now: string,
  ): Promise<PasswordResetRecord | null> {
    const record = this.#passwordResets.get(tokenHash);
    if (!record || record.expiresAt <= now) {
      if (record) this.#passwordResets.delete(tokenHash);
      return null;
    }
    this.#passwordResets.delete(tokenHash);
    return record;
  }

  async deletePasswordResetsByUser(userId: string): Promise<void> {
    for (const [tokenHash, reset] of this.#passwordResets) {
      if (reset.userId === userId) this.#passwordResets.delete(tokenHash);
    }
  }
}
