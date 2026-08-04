import { describe, expect, it } from "vitest";
import { InMemoryAuthRepository } from "../auth/auth-repository.js";
import { AuthService } from "../auth/auth-service.js";
import { InMemoryObjectStorage } from "../storage/object-storage.js";
import {
  AccountDeletionProcessor,
  AccountPrivacyService,
  InMemoryAccountPrivacyRepository,
} from "./account-privacy.js";
import {
  CURRENT_PRIVACY_VERSION,
  CURRENT_TERMS_VERSION,
} from "@motionprep/contracts";
import { TEST_PASSWORD } from "../app-test-helpers.js";

class FailsOnceStorage extends InMemoryObjectStorage {
  failures = 1;

  override async delete(key: string): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("temporary storage outage");
    }
    await super.delete(key);
  }
}

describe("account privacy", () => {
  it("keeps a failed deletion durable and completes it on the maintenance retry", async () => {
    const authRepository = new InMemoryAuthRepository();
    const auth = new AuthService(authRepository);
    const registration = await auth.register({
      name: "Privacy Owner",
      email: "privacy-owner@example.com",
      password: TEST_PASSWORD,
      legal: {
        accepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
      },
    });
    const repository = new InMemoryAccountPrivacyRepository(authRepository);
    const storage = new FailsOnceStorage();
    const prepared = await repository.prepareDeletion(
      registration.session.user.id,
      "2026-08-04T10:00:00.000Z",
    );
    if (prepared.kind !== "ready") throw new Error("Unexpected billing block.");
    prepared.request.objectKeys.push("sources/project/private.png");
    await storage.put({
      key: "sources/project/private.png",
      contentType: "image/png",
      sizeBytes: 1,
      body: Buffer.from([1]),
    });
    const processor = new AccountDeletionProcessor(
      repository,
      storage,
      () => new Date("2026-08-04T10:01:00.000Z"),
    );

    await expect(processor.process(prepared.request)).resolves.toBe("failed");
    const retried = await repository.prepareDeletion(
      registration.session.user.id,
      "2026-08-04T10:02:00.000Z",
    );
    if (retried.kind !== "ready") throw new Error("Unexpected billing block.");
    expect(retried.request.attempt).toBe(2);
    await expect(processor.process(retried.request)).resolves.toBe("completed");
    const replayed = await repository.prepareDeletion(
      registration.session.user.id,
      "2026-08-04T10:03:00.000Z",
    );
    expect(replayed).toMatchObject({ kind: "ready", request: { status: "completed" } });
    await repository.markDeletionFailed(
      crypto.randomUUID(),
      "2026-08-04T10:04:00.000Z",
      "ignored",
    );
    await repository.completeDeletion(
      crypto.randomUUID(),
      registration.session.user.id,
      "2026-08-04T10:04:00.000Z",
    );
    await expect(storage.inspect("sources/project/private.png")).resolves.toBeNull();
    await expect(auth.session(registration.token)).rejects.toMatchObject({
      code: "SESSION_INVALID",
    });
  });

  it("requires the current password before changing account state", async () => {
    const authRepository = new InMemoryAuthRepository();
    const auth = new AuthService(authRepository);
    const registration = await auth.register({
      name: "Protected Owner",
      email: "protected-owner@example.com",
      password: TEST_PASSWORD,
      legal: {
        accepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
      },
    });
    const repository = new InMemoryAccountPrivacyRepository(authRepository);
    const service = new AccountPrivacyService(
      repository,
      auth,
      new AccountDeletionProcessor(repository, new InMemoryObjectStorage()),
    );

    await expect(
      service.requestDeletion({
        userId: registration.session.user.id,
        password: "WrongPassword123",
      }),
    ).rejects.toMatchObject({ code: "CURRENT_PASSWORD_INVALID" });
    await expect(auth.session(registration.token)).resolves.toBeTruthy();

    await expect(
      service.requestDeletion({
        userId: registration.session.user.id,
        password: TEST_PASSWORD,
      }),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(
      repository.exportAccount("missing-user", "2026-08-04T10:00:00.000Z"),
    ).rejects.toThrow("Account not found");
  });
});
