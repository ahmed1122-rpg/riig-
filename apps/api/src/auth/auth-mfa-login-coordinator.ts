import type { SessionView, UserSummary } from "@motionprep/contracts";
import type {
  AuthRepository,
  SessionRecord,
  UserRecord,
} from "./auth-repository.js";
import type { SecretProtector } from "./secret-protector.js";
import { verifyTotpCode } from "./totp.js";

export type SecondFactorMatch =
  | { kind: "totp" }
  | { kind: "recovery"; codeHash: string };

interface AuthMfaLoginDependencies {
  repository: AuthRepository;
  now: () => Date;
  sessionTtlSeconds: number;
  secretProtector: SecretProtector;
  randomToken: () => string;
  hashToken: (token: string) => string;
  publicUser: (user: UserRecord) => UserSummary;
  domainError: (
    code: "MFA_CHALLENGE_INVALID" | "MFA_CODE_INVALID",
    message: string,
  ) => Error;
}

export class AuthMfaLoginCoordinator {
  constructor(private readonly dependencies: AuthMfaLoginDependencies) {}

  async complete(input: {
    challengeToken: string;
    code: string;
  }): Promise<{ kind: "session"; session: SessionView; token: string }> {
    const { repository } = this.dependencies;
    const now = this.dependencies.now();
    const nowIso = now.toISOString();
    const tokenHash = this.dependencies.hashToken(input.challengeToken);
    const challenge = await repository.findMfaChallenge(tokenHash, nowIso);
    if (!challenge) throw this.invalidChallenge();

    const user = await repository.findUserById(challenge.userId);
    if (!isMfaLoginUser(user)) throw this.invalidChallenge();
    const factor = matchSecondFactor(
      user,
      input.code,
      this.dependencies.secretProtector,
      now.getTime(),
    );
    if (!factor) {
      throw this.dependencies.domainError(
        "MFA_CODE_INVALID",
        "رمز التحقق غير صحيح.",
      );
    }

    const token = this.dependencies.randomToken();
    const session: SessionRecord = {
      tokenHash: this.dependencies.hashToken(token),
      userId: user.id,
      createdAt: nowIso,
      expiresAt: new Date(
        now.getTime() + this.dependencies.sessionTtlSeconds * 1000,
      ).toISOString(),
    };
    const committed = await repository.commitMfaLogin({
      tokenHash,
      userId: user.id,
      now: nowIso,
      lastLoginAt: nowIso,
      session,
      ...(factor.kind === "recovery"
        ? { recoveryCodeHash: factor.codeHash }
        : {}),
    });
    if (committed !== "committed") {
      throw committed === "recovery_invalid"
        ? this.dependencies.domainError(
            "MFA_CODE_INVALID",
            "رمز الاسترداد غير صالح أو استُخدم سابقًا.",
          )
        : this.invalidChallenge();
    }

    const authenticatedUser: UserRecord = {
      ...user,
      lastLoginAt: nowIso,
      recoveryCodeHashes:
        factor.kind === "recovery"
          ? user.recoveryCodeHashes.filter(
              (hash) => hash !== factor.codeHash,
            )
          : user.recoveryCodeHashes,
    };
    return {
      kind: "session",
      token,
      session: {
        user: this.dependencies.publicUser(authenticatedUser),
        expiresAt: session.expiresAt,
      },
    };
  }

  private invalidChallenge(): Error {
    return this.dependencies.domainError(
      "MFA_CHALLENGE_INVALID",
      "انتهى تحدي التحقق أو استُخدم بالفعل.",
    );
  }
}

export function matchSecondFactor(
  user: UserRecord,
  code: string,
  secretProtector: SecretProtector,
  timestampMs: number,
): SecondFactorMatch | null {
  if (!user.mfaSecretCiphertext) return null;
  const secret = secretProtector.unprotect(user.mfaSecretCiphertext);
  if (verifyTotpCode(secret, code, timestampMs)) return { kind: "totp" };
  const codeHash = user.recoveryCodeHashes.find((hash) =>
    secretProtector.verifyRecoveryCode(code, hash),
  );
  return codeHash ? { kind: "recovery", codeHash } : null;
}

function isMfaLoginUser(user: UserRecord | null): user is UserRecord {
  return Boolean(
    user?.mfaEnabled &&
      user.status === "active" &&
      !user.deletionRequestedAt &&
      !user.deletedAt,
  );
}
