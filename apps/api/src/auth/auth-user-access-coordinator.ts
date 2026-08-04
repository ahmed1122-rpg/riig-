import type { UserRole, UserStatus, UserSummary } from "@motionprep/contracts";
import type { AuthRepository, UserRecord } from "./auth-repository.js";
import { hashPassword } from "./password.js";

type UserAccessErrorCode =
  | "SESSION_INVALID"
  | "USER_NOT_FOUND"
  | "LAST_ADMIN_PROTECTED";

interface AuthUserAccessCoordinatorOptions {
  repository: AuthRepository;
  now: () => Date;
  publicUser: (user: UserRecord) => UserSummary;
  domainError: (code: UserAccessErrorCode, message: string) => Error;
}

export class AuthUserAccessCoordinator {
  constructor(private readonly options: AuthUserAccessCoordinatorOptions) {}

  async listUsers(): Promise<UserSummary[]> {
    return (await this.options.repository.listUsers()).map(
      this.options.publicUser,
    );
  }

  async updateUserAccess(
    actor: UserSummary,
    userId: string,
    changes: { role?: UserRole; status?: UserStatus },
  ): Promise<UserSummary> {
    if (actor.role !== "admin") {
      throw this.options.domainError(
        "SESSION_INVALID",
        "ليس لديك صلاحية كافية.",
      );
    }
    const target = await this.options.repository.findUserById(userId);
    if (!target) {
      throw this.options.domainError("USER_NOT_FOUND", "المستخدم غير موجود.");
    }
    const removesAdminAccess =
      target.role === "admin" &&
      ((changes.role !== undefined && changes.role !== "admin") ||
        changes.status === "suspended");
    if (removesAdminAccess) {
      const activeAdmins = (await this.options.repository.listUsers()).filter(
        (user) => user.role === "admin" && user.status === "active",
      );
      if (activeAdmins.length <= 1) {
        throw this.options.domainError(
          "LAST_ADMIN_PROTECTED",
          "لا يمكن إزالة صلاحية آخر مسؤول نشط.",
        );
      }
    }
    if (actor.id === userId && changes.status === "suspended") {
      throw this.options.domainError(
        "LAST_ADMIN_PROTECTED",
        "لا يمكن للمسؤول إيقاف حسابه الحالي.",
      );
    }
    const updated = await this.options.repository.updateUser(userId, changes);
    if (!updated) {
      throw this.options.domainError("USER_NOT_FOUND", "المستخدم غير موجود.");
    }
    if (changes.role !== undefined || changes.status === "suspended") {
      await this.options.repository.deleteSessionsByUser(userId);
    }
    return this.options.publicUser(updated);
  }

  async seedUser(input: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
  }): Promise<UserSummary> {
    const existing = await this.options.repository.findUserByEmail(input.email);
    if (existing) return this.options.publicUser(existing);
    const timestamp = this.options.now().toISOString();
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
      termsVersion: null,
      privacyVersion: null,
      legalAcceptedAt: null,
      deletionRequestedAt: null,
      deletedAt: null,
    };
    await this.options.repository.saveUser(user);
    return this.options.publicUser(user);
  }
}
