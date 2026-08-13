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

  override async purge(
    keys: readonly string[],
    prefixes: readonly string[],
  ): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("temporary storage outage");
    }
    await super.purge(keys, prefixes);
  }
}

class FailsListingStorage extends InMemoryObjectStorage {
  override async list(): Promise<string[]> {
    throw new Error("temporary listing outage");
  }
}

describe("account privacy", () => {
  it("releases the processor claim when prefix inventory listing fails", async () => {
    const authRepository = new InMemoryAuthRepository();
    const auth = new AuthService(authRepository);
    const registration = await auth.register({
      name: "Listing Failure Owner",
      email: "listing-failure@example.com",
      password: TEST_PASSWORD,
      legal: {
        accepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
      },
    });
    const repository = new InMemoryAccountPrivacyRepository(authRepository);
    const prepared = await repository.prepareDeletion(
      registration.session.user.id,
      "2026-08-04T10:00:00.000Z",
    );
    if (prepared.kind !== "ready") throw new Error("Unexpected billing block.");
    prepared.request.objectPrefixes.push("sources/project/");
    const processor = new AccountDeletionProcessor(
      repository,
      new FailsListingStorage(),
      () => new Date("2026-08-04T10:01:00.000Z"),
    );

    await expect(processor.process(prepared.request)).resolves.toBe("failed");
    const pending = await repository.listPendingDeletions(10);
    expect(pending).toEqual([
      expect.objectContaining({ id: prepared.request.id, status: "failed" }),
    ]);
    await expect(repository.claimDeletion(
      prepared.request.id,
      "retry-processor",
      "2026-08-04T10:02:00.000Z",
      "2026-08-04T11:02:00.000Z",
    )).resolves.toBe(true);
  });

  it("allows only one processor to own a deletion attempt", async () => {
    const authRepository = new InMemoryAuthRepository();
    const auth = new AuthService(authRepository);
    const registration = await auth.register({
      name: "Deletion Lease Owner",
      email: "deletion-lease@example.com",
      password: TEST_PASSWORD,
      legal: {
        accepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
      },
    });
    const repository = new InMemoryAccountPrivacyRepository(authRepository);
    const prepared = await repository.prepareDeletion(
      registration.session.user.id,
      "2026-08-04T10:00:00.000Z",
    );
    if (prepared.kind !== "ready") throw new Error("Unexpected billing block.");
    const storage = new InMemoryObjectStorage();
    const processor = new AccountDeletionProcessor(
      repository,
      storage,
      () => new Date("2026-08-04T10:01:00.000Z"),
    );

    const results = await Promise.all([
      processor.process(prepared.request),
      processor.process(prepared.request),
    ]);

    expect(results.sort()).toEqual(["completed", "processing"]);
  });

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
      "unused",
    );
    await repository.completeDeletion(
      crypto.randomUUID(),
      registration.session.user.id,
      "2026-08-04T10:04:00.000Z",
      "unused",
    );
    await expect(storage.inspect("sources/project/private.png")).resolves.toBeNull();
    await expect(auth.session(registration.token)).rejects.toMatchObject({
      code: "SESSION_INVALID",
    });
  });

  it("rebuilds the final prefix inventory and clears private audit keys", async () => {
    const authRepository = new InMemoryAuthRepository();
    const auth = new AuthService(authRepository);
    const registration = await auth.register({
      name: "Late Object Owner",
      email: "late-object@example.com",
      password: TEST_PASSWORD,
      legal: {
        accepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        privacyVersion: CURRENT_PRIVACY_VERSION,
      },
    });
    const repository = new InMemoryAccountPrivacyRepository(authRepository);
    const storage = new InMemoryObjectStorage();
    const prepared = await repository.prepareDeletion(
      registration.session.user.id,
      "2026-08-04T10:00:00.000Z",
    );
    if (prepared.kind !== "ready") throw new Error("Unexpected billing block.");
    prepared.request.objectPrefixes.push("sources/project/");
    await storage.put({
      key: "sources/project/late.png",
      contentType: "image/png",
      sizeBytes: 1,
      body: Buffer.from([1]),
    });

    await expect(new AccountDeletionProcessor(repository, storage).process(
      prepared.request,
    )).resolves.toBe("completed");

    await expect(storage.inspect("sources/project/late.png")).resolves.toBeNull();
    const replayed = await repository.prepareDeletion(
      registration.session.user.id,
      "2026-08-04T10:02:00.000Z",
    );
    expect(replayed).toMatchObject({
      kind: "ready",
      request: { phase: "completed", objectKeys: [], objectPrefixes: [] },
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
