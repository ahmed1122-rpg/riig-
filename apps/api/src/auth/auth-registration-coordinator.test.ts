import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from "@motionprep/contracts";
import { TEST_PASSWORD } from "../app-test-helpers.js";
import { AuthRegistrationCoordinator } from "./auth-registration-coordinator.js";
import { InMemoryAuthRepository } from "./auth-repository.js";
import { InMemoryEmailSender } from "./email-sender.js";

const legal = {
  accepted: true as const,
  termsVersion: CURRENT_TERMS_VERSION,
  privacyVersion: CURRENT_PRIVACY_VERSION,
};

describe("authentication registration coordinator", () => {
  it("keeps a registration pending until its one-use email token is consumed", async () => {
    const fixture = createFixture();
    const registered = await fixture.coordinator.register({
      name: "Pending creator",
      email: "creator@example.test",
      password: TEST_PASSWORD,
      legal,
    });
    expect(registered.kind).toBe("verification_required");
    expect(fixture.sender.emailVerifications).toHaveLength(1);
    expect((await fixture.repository.findUserByEmail("creator@example.test"))?.status)
      .toBe("pending_verification");

    const verified = await fixture.coordinator.verifyEmail("verification-token-1");
    expect(verified.status).toBe("active");
    await expect(
      fixture.coordinator.verifyEmail("verification-token-1"),
    ).rejects.toMatchObject({ message: expect.stringContaining("التحقق") });
  });

  it("replaces the previous token without disclosing unknown addresses", async () => {
    const fixture = createFixture();
    await fixture.coordinator.register({
      name: "Pending creator",
      email: "creator@example.test",
      password: TEST_PASSWORD,
      legal,
    });
    await expect(
      fixture.coordinator.requestVerification("missing@example.test"),
    ).resolves.toBeUndefined();
    await fixture.coordinator.requestVerification("creator@example.test");
    expect(fixture.sender.emailVerifications).toHaveLength(2);
    await expect(
      fixture.coordinator.verifyEmail("verification-token-1"),
    ).rejects.toThrow();
    await expect(
      fixture.coordinator.verifyEmail("verification-token-2"),
    ).resolves.toMatchObject({ status: "active" });
  });

  it("allows exactly one administrator bootstrap", async () => {
    const fixture = createFixture({
      adminBootstrapEmail: "owner@example.test",
      adminBootstrapTokenHash: digest("bootstrap-token"),
    });
    const input = {
      name: "Owner",
      email: "owner@example.test",
      password: TEST_PASSWORD,
      token: "bootstrap-token",
      legal,
    };
    const first = await fixture.coordinator.bootstrapAdmin(input);
    expect(first.role).toBe("admin");
    await expect(fixture.coordinator.bootstrapAdmin(input)).rejects.toThrow(
      /تهيئة المسؤول/u,
    );
  });

  it("serializes twenty competing administrator bootstrap attempts", async () => {
    const fixture = createFixture({
      adminBootstrapEmail: "owner@example.test",
      adminBootstrapTokenHash: digest("bootstrap-token"),
    });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        fixture.coordinator.bootstrapAdmin({
          name: "Owner",
          email: "owner@example.test",
          password: TEST_PASSWORD,
          token: "bootstrap-token",
          legal,
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(19);
  });
});

function createFixture(bootstrap: {
  adminBootstrapEmail?: string;
  adminBootstrapTokenHash?: string;
} = {}) {
  const repository = new InMemoryAuthRepository();
  const sender = new InMemoryEmailSender();
  let tokenCounter = 0;
  const coordinator = new AuthRegistrationCoordinator({
    repository,
    emailSender: sender,
    now: () => new Date("2026-08-13T10:00:00.000Z"),
    verificationRequired: true,
    verificationUrl: "https://studio.example.test/auth",
    registrationRoleForEmail: () => "creator",
    ...bootstrap,
    randomToken: () => `verification-token-${++tokenCounter}`,
    hashToken: digest,
    domainError: (_code, message) => new Error(message),
  });
  return { coordinator, repository, sender };
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
