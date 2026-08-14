import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemoryAuthRepository,
  type UserRecord,
} from "./auth-repository.js";
import { AuthDomainError, AuthService } from "./auth-service.js";
import { AesGcmSecretProtector } from "./secret-protector.js";
import { createTotpCode, generateTotpSecret } from "./totp.js";

const NOW = new Date("2026-08-13T12:00:00.000Z");
const USER_ID = "user-mfa-atomicity";
const RECOVERY_CODE = "ABCDE-12345";

describe("atomic MFA consumption", () => {
  it("creates exactly one session for 20 concurrent TOTP submissions", async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const fixture = await createFixture();
      const challengeToken = `totp-challenge-token-${iteration}`;
      await saveChallenge(fixture.repository, challengeToken);
      const code = createTotpCode(fixture.secret, NOW.getTime());
      const results = await Promise.allSettled(
        Array.from({ length: 20 }, () =>
          fixture.service.completeMfaLogin({ challengeToken, code }),
        ),
      );

      const successes = results.filter(
        (result) => result.status === "fulfilled",
      );
      expect(successes).toHaveLength(1);
      expectMfaFailures(results, "MFA_CHALLENGE_INVALID", 19);
      const winner = successes[0];
      if (winner?.status !== "fulfilled") {
        throw new Error("Missing MFA winner.");
      }
      await expect(
        fixture.service.session(winner.value.token),
      ).resolves.toMatchObject({ user: { id: USER_ID } });
    }
  });

  it("allows only one of 20 challenges to consume the same recovery code", async () => {
    for (let iteration = 0; iteration < 20; iteration += 1) {
      const fixture = await createFixture();
      const challengeTokens = Array.from(
        { length: 20 },
        (_, index) => `recovery-${iteration}-challenge-${index}`,
      );
      await Promise.all(
        challengeTokens.map((token) =>
          saveChallenge(fixture.repository, token),
        ),
      );
      const results = await Promise.allSettled(
        challengeTokens.map((challengeToken) =>
          fixture.service.completeMfaLogin({
            challengeToken,
            code: RECOVERY_CODE,
          }),
        ),
      );

      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expectMfaFailures(results, "MFA_CHALLENGE_INVALID", 19);
      expect(
        (await fixture.repository.findUserById(USER_ID))?.recoveryCodeHashes,
      ).toEqual([]);
    }
  });

  it("does not consume a challenge or recovery code after invalid input", async () => {
    const fixture = await createFixture();
    const challengeToken = "invalid-then-valid-challenge";
    await saveChallenge(fixture.repository, challengeToken);

    await expect(
      fixture.service.completeMfaLogin({ challengeToken, code: "invalid" }),
    ).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    await expect(
      fixture.service.completeMfaLogin({
        challengeToken,
        code: RECOVERY_CODE,
      }),
    ).resolves.toMatchObject({ kind: "session" });
  });

  it("keeps the challenge usable after a previously consumed recovery code", async () => {
    const fixture = await createFixture();
    const challengeToken = "spent-recovery-then-totp";
    const recoveryHash = fixture.protector.hashRecoveryCode(RECOVERY_CODE);
    await saveChallenge(fixture.repository, challengeToken);
    await expect(
      fixture.repository.consumeRecoveryCode(USER_ID, recoveryHash),
    ).resolves.toBe(true);

    await expect(
      fixture.service.completeMfaLogin({
        challengeToken,
        code: RECOVERY_CODE,
      }),
    ).rejects.toMatchObject({ code: "MFA_CODE_INVALID" });
    await expect(
      fixture.service.completeMfaLogin({
        challengeToken,
        code: createTotpCode(fixture.secret, NOW.getTime()),
      }),
    ).resolves.toMatchObject({ kind: "session" });
  });

  it("removes a stored recovery hash with compare-and-swap semantics", async () => {
    const fixture = await createFixture();
    const hash = fixture.protector.hashRecoveryCode(RECOVERY_CODE);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        fixture.repository.consumeRecoveryCode(USER_ID, hash),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((consumed) => !consumed)).toHaveLength(19);
  });
});

async function createFixture() {
  const repository = new InMemoryAuthRepository();
  const protector = new AesGcmSecretProtector(Buffer.alloc(32, 7));
  const secret = generateTotpSecret(Buffer.alloc(20, 11));
  const user: UserRecord = {
    id: USER_ID,
    name: "MFA Atomicity",
    email: "mfa-atomicity@example.test",
    role: "creator",
    status: "active",
    passwordHash: "not-used-by-this-test",
    mfaEnabled: true,
    mfaSecretCiphertext: protector.protect(secret),
    recoveryCodeHashes: [protector.hashRecoveryCode(RECOVERY_CODE)],
    createdAt: NOW.toISOString(),
    lastLoginAt: null,
    deletionRequestedAt: null,
    deletedAt: null,
  };
  await repository.saveUser(user);
  return {
    repository,
    protector,
    secret,
    service: new AuthService(repository, () => new Date(NOW), 3_600, undefined, {
      secretProtector: protector,
    }),
  };
}

async function saveChallenge(
  repository: InMemoryAuthRepository,
  challengeToken: string,
): Promise<void> {
  await repository.saveMfaChallenge({
    tokenHash: createHash("sha256").update(challengeToken).digest("hex"),
    userId: USER_ID,
    expiresAt: new Date(NOW.getTime() + 60_000).toISOString(),
  });
}

function expectMfaFailures(
  results: PromiseSettledResult<unknown>[],
  code: AuthDomainError["code"],
  expectedCount: number,
): void {
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  expect(failures).toHaveLength(expectedCount);
  for (const failure of failures) {
    expect(failure.reason).toBeInstanceOf(AuthDomainError);
    expect(failure.reason).toMatchObject({ code });
  }
}
