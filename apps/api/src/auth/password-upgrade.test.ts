import { scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TEST_PASSWORD } from "../app-test-helpers.js";
import { AuthService } from "./auth-service.js";
import { InMemoryAuthRepository } from "./auth-repository.js";
import { passwordHashNeedsUpgrade } from "./password.js";

describe("password hash upgrades", () => {
  it("upgrades a valid legacy hash only after an active user signs in", async () => {
    const repository = new InMemoryAuthRepository();
    const salt = Buffer.alloc(16, 9);
    const key = scryptSync(TEST_PASSWORD, salt, 64);
    const legacyHash = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
    const userId = crypto.randomUUID();
    await repository.saveUser({
      id: userId,
      name: "Legacy user",
      email: "legacy@example.test",
      role: "creator",
      status: "active",
      passwordHash: legacyHash,
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      recoveryCodeHashes: [],
      createdAt: "2026-08-13T00:00:00.000Z",
      lastLoginAt: null,
    });

    const result = await new AuthService(repository).login({
      email: "legacy@example.test",
      password: TEST_PASSWORD,
      attemptKey: "legacy-test",
    });

    expect(result.kind).toBe("session");
    const upgraded = await repository.findUserById(userId);
    expect(upgraded?.passwordHash).not.toBe(legacyHash);
    expect(passwordHashNeedsUpgrade(upgraded?.passwordHash ?? "")).toBe(false);
  });

  it("upgrades a valid v2 hash to the current work factor after sign-in", async () => {
    const repository = new InMemoryAuthRepository();
    const salt = Buffer.alloc(16, 8);
    const key = scryptSync(TEST_PASSWORD, salt, 64, {
      N: 16_384,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    const v2Hash = `scrypt$v2$16384$8$1$${salt.toString("hex")}$${key.toString("hex")}`;
    const userId = crypto.randomUUID();
    await repository.saveUser({
      id: userId,
      name: "Version two user",
      email: "v2@example.test",
      role: "creator",
      status: "active",
      passwordHash: v2Hash,
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      recoveryCodeHashes: [],
      createdAt: "2026-08-16T00:00:00.000Z",
      lastLoginAt: null,
    });

    const result = await new AuthService(repository).login({
      email: "v2@example.test",
      password: TEST_PASSWORD,
      attemptKey: "v2-test",
    });

    expect(result.kind).toBe("session");
    const upgraded = await repository.findUserById(userId);
    expect(upgraded?.passwordHash).toMatch(/^scrypt\$v3\$32768\$8\$3\$/u);
    expect(passwordHashNeedsUpgrade(upgraded?.passwordHash ?? "")).toBe(false);
  });

  it("does not rewrite a suspended account even when its password is legacy", async () => {
    const repository = new InMemoryAuthRepository();
    const salt = Buffer.alloc(16, 3);
    const key = scryptSync(TEST_PASSWORD, salt, 64);
    const legacyHash = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
    const userId = crypto.randomUUID();
    await repository.saveUser({
      id: userId,
      name: "Suspended user",
      email: "suspended@example.test",
      role: "creator",
      status: "suspended",
      passwordHash: legacyHash,
      mfaEnabled: false,
      mfaSecretCiphertext: null,
      recoveryCodeHashes: [],
      createdAt: "2026-08-13T00:00:00.000Z",
      lastLoginAt: null,
    });

    await expect(
      new AuthService(repository).login({
        email: "suspended@example.test",
        password: TEST_PASSWORD,
        attemptKey: "suspended-test",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    expect((await repository.findUserById(userId))?.passwordHash).toBe(legacyHash);
  });
});
